import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Document, isAlias, parseDocument } from 'yaml';
import { UptideError } from '../errors.js';
import { satisfies, validRange } from '../fetch/range.js';
import { parseUptideConfig } from '../onboarding/config.js';
import { UPTIDE_CONFIG_FILE } from '../onboarding/schema.js';
import { globRegExp } from '../workspaces.js';

export interface RootPin {
  file: string;
  path: string[];
  name: string;
  before: string;
  after: string;
  to: string;
}

export const describeRootPin = (pin: RootPin): string =>
  `${pin.file} ${pin.path.map((key) => JSON.stringify(key)).join(' > ')} pins ${pin.name} to ${pin.before}; it will be updated to ${pin.to}${pin.after.startsWith('$') ? ` (via ${pin.after})` : ''}.`;

/** Only unconditional pins can be changed without guessing which installed copy they select. */
export function planRootPins(
  root: string,
  moves: readonly { name: string; to: string }[],
  options: { updatePins?: boolean; pr?: boolean; forPublication?: boolean } = {},
  read = (file: string): string | undefined =>
    existsSync(join(root, file)) ? readFileSync(join(root, file), 'utf8') : undefined,
): RootPin[] {
  const manifest = JSON.parse(read('package.json') ?? '{}');
  const pins: RootPin[] = [];
  function visit(file: string, path: string[], table: unknown, nested = false): void {
    if (!table || typeof table !== 'object') return;
    for (const [key, value] of Object.entries(table)) {
      const field = [...path, key];
      for (const move of moves) {
        const leaf =
          key
            .split('>')
            .at(-1)
            ?.trim()
            .match(/(?:^|\/)((?:@[^/]+\/)?[^/]+)$/)?.[1] ?? key;
        // shortcut: brace/class selectors need manual edits, add manager-specific matching to support them.
        const matches =
          /[{}[\]]/.test(key) ||
          leaf === move.name ||
          leaf.startsWith(`${move.name}@`) ||
          globRegExp(leaf).test(move.name);
        if (!matches) continue;
        const safe =
          !nested &&
          (key === move.name || (path[0] === 'resolutions' && key === `**/${move.name}`));
        const object = value !== null && typeof value === 'object';
        const before = object ? (value as Record<string, unknown>)['.'] : value;
        if (safe && object && before === undefined) continue;
        const reference = `$${move.name}`;
        const direct = ['dependencies', 'devDependencies', 'optionalDependencies'].some(
          (section) => typeof manifest[section]?.[move.name] === 'string',
        );
        if (safe && before === reference && direct && path[0] !== 'resolutions') continue;
        if (!safe || typeof before !== 'string' || !validRange(before))
          throw new UptideError(
            'INCONSISTENT_UPGRADE',
            `${file} ${field.join(' > ')} may pin ${move.name}, but its selector or value cannot be updated safely. Update or remove that entry manually and rerun. Nothing was changed.`,
          );
        if (satisfies(move.to, before)) continue;
        pins.push({
          file,
          path: object ? [...field, '.'] : field,
          name: move.name,
          before,
          // npm rejects a direct dependency override unless its spec equals the declaration.
          after: file === 'package.json' && path[0] === 'overrides' && direct ? reference : move.to,
          to: move.to,
        });
      }
      if (value && typeof value === 'object') {
        const children = Object.fromEntries(
          Object.entries(value).filter(([child]) => child !== '.'),
        );
        visit(file, field, children, true);
      }
    }
  }
  visit('package.json', ['resolutions'], manifest.resolutions);
  visit('package.json', ['overrides'], manifest.overrides);
  visit('package.json', ['pnpm', 'overrides'], manifest.pnpm?.overrides);
  const yaml = read('pnpm-workspace.yaml');
  if (yaml !== undefined) {
    const doc = parseDocument(yaml);
    if (doc.errors.length) throw doc.errors[0];
    visit('pnpm-workspace.yaml', ['overrides'], doc.toJS()?.overrides);
    for (const pin of pins.filter((pin) => pin.file === 'pnpm-workspace.yaml'))
      assertIndependentYamlPin(doc, pin.path);
  }
  let updatePins = options.updatePins;
  if (pins.length && updatePins === undefined && (options.pr || options.forPublication)) {
    const config = read(UPTIDE_CONFIG_FILE);
    updatePins = config === undefined || parseUptideConfig(config).config.updatePins !== false;
  }
  if (pins.length && !updatePins)
    throw new UptideError(
      'INCONSISTENT_UPGRADE',
      `Root pins conflict with this upgrade:\n${pins.map(describeRootPin).join('\n')}\nRerun with --update-pins to approve these changes, or update them manually. Nothing was changed.`,
    );
  return pins;
}

/** An anchored value can also be another package's pin. */
export function assertIndependentYamlPin(doc: Document, path: string[]): void {
  for (let length = 1; length <= path.length; length++) {
    const node = doc.getIn(path.slice(0, length), true);
    if (isAlias(node) || (node && typeof node === 'object' && 'anchor' in node && node.anchor))
      throw new UptideError(
        'INCONSISTENT_UPGRADE',
        `pnpm-workspace.yaml ${path.join(' > ')} uses a YAML anchor or alias; update it manually to avoid changing unrelated pins. Nothing was changed.`,
      );
  }
}

/** Re-read after dependency/catalog bumps so both edits survive in the upgrade commit. */
export function writeRootPins(root: string, pins: readonly RootPin[]): string[] {
  const files: string[] = [];
  for (const file of new Set(pins.map((pin) => pin.file))) {
    const absolute = join(root, file);
    const original = readFileSync(absolute, 'utf8');
    const yaml = file.endsWith('.yaml') ? parseDocument(original) : undefined;
    if (yaml?.errors.length) throw yaml.errors[0];
    const json = yaml ? undefined : JSON.parse(original);
    for (const pin of pins.filter((pin) => pin.file === file)) {
      if (yaml) yaml.setIn(pin.path, pin.after);
      else {
        let table = json;
        for (const key of pin.path.slice(0, -1)) table = table[key];
        table[pin.path[pin.path.length - 1] as string] = pin.after;
      }
    }
    writeFileSync(
      absolute,
      yaml
        ? yaml.toString()
        : `${JSON.stringify(json, null, original.match(/\n(\s+)"/)?.[1] ?? '  ')}\n`,
    );
    files.push(absolute);
  }
  return files;
}
