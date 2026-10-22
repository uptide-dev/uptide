import { assertManagerAvailable } from './managers/availability.js';
import { isolatedUpgrade } from './managers/isolated-install.js';
import type { InstallReport, Upgrade } from './managers/upgrade.js';

export { frozenInstall, packageManager } from './managers/manager.js';

import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseDocument } from 'yaml';
import { workspacePackagesOf } from '../adapters/typescript/repo.js';
import { compareVersions, parseVersion } from '../check/version.js';
import { SafetyRefusal, UptideError } from '../errors.js';
import { satisfies, validRange } from '../fetch/range.js';
import { installedManifest } from '../list/evidence.js';
import { command } from './process.js';
import { assertIndependentYamlPin } from './root-pins.js';

/** Check installed copies in every workspace before a plan can write manifests or install. */
export function assertNoDowngrades(
  root: string,
  moves: readonly { name: string; to: string }[],
): void {
  const rejected = new Set<string>();
  for (const workspace of workspacePackagesOf(root)) {
    for (const move of moves) {
      const from = installedManifest(root, workspace, move.name)?.version;
      if (from && compareVersions(move.to, from) < 0)
        rejected.add(`${move.name} ${from} → ${move.to} (${workspace})`);
    }
  }
  if (rejected.size)
    throw new SafetyRefusal(
      'INCONSISTENT_UPGRADE',
      `Refusing planned downgrades before install:\n${[...rejected].join('\n')}\nNothing was changed.`,
    );
}

const sections = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;
/** Check the packages verification will actually load, including workspace-local copies. */
export function assertInstalledVersions(
  root: string,
  moves: readonly { name: string; to: string }[],
): void {
  const missing = new Set(moves.map((move) => move.name));
  for (const workspace of workspacePackagesOf(root)) {
    const manifest = JSON.parse(readFileSync(join(root, workspace, 'package.json'), 'utf8'));
    for (const { name, to } of moves) {
      if (!sections.some((section) => typeof manifest[section]?.[name] === 'string')) continue;
      missing.delete(name);
      const installed = installedManifest(root, workspace, name)?.version;
      if (installed !== to)
        throw new UptideError(
          'INSTALL_FAILED',
          `Requested ${name}@${to}, but ${workspace} has ${installed ?? 'nothing'} installed; verification cannot use a different target.`,
        );
    }
  }
  if (missing.size)
    throw new UptideError(
      'INSTALL_FAILED',
      `Cannot verify planned packages no workspace declares: ${[...missing].join(', ')}.`,
    );
}

/** Keep the operator, precision and trailing wildcards, including simple npm aliases. */
export function versionRange(before: string, version: string): string {
  const alias = /^(npm:(?:@[^/\s]+\/)?[^@\s]+@)(.+)$/.exec(before);
  if (alias) return `${alias[1]}${versionRange(alias[2] as string, version)}`;
  const match = /^(\s*[~^]?\s*v?)(\d+(?:\.(?:\d+|[xX*])){0,2})(-[\w.-]+)?(\+[\w.-]+)?\s*$/.exec(
    before,
  );
  const parts = match?.[2]?.split('.');
  if (
    !match ||
    !parts ||
    ((match[3] || match[4]) && (parts.length !== 3 || !parts.every((p) => /^\d+$/.test(p)))) ||
    parts.some((p, i) => /[xX*]/.test(p) && parts.slice(i + 1).some((q) => /^\d+$/.test(q)))
  )
    throw new UptideError(
      'UNSUPPORTED_VERSION_RANGE',
      `Cannot preserve version range ${JSON.stringify(before)}; add the target major to the range without removing existing alternatives before fixing.`,
    );
  const target = version.split('.');
  const full = parts.length === 3 && parts.every((p) => /^\d+$/.test(p));
  return `${match[1]}${full ? version : parts.map((p, i) => (/^[xX*]$/.test(p) ? p : target[i])).join('.')}`;
}

function declaredRange(
  before: string,
  version: string,
  file: string,
  field: string,
  name: string,
  peer = false,
): string {
  const alias = /^(npm:(?:@[^/\s]+\/)?[^@\s]+@)(.+)$/.exec(before);
  const range = alias?.[2] ?? before;
  if (satisfies(version, range)) return before;
  const target = parseVersion(version);
  if (!target) throw new Error('target must be an exact version');
  const addition = `^${target.pre || target.major === 0 ? version : `${target.major}.0.0`}`;
  if (peer && validRange(range)) return `${before} || ${addition}`;
  try {
    return versionRange(before, version);
  } catch (error) {
    if (!(error instanceof UptideError) || error.code !== 'UNSUPPORTED_VERSION_RANGE') throw error;
    throw new UptideError(
      'UNSUPPORTED_VERSION_RANGE',
      `${file}: ${field} declares ${JSON.stringify(before)}, which cannot be rewritten safely. Add the target ${name} major (${addition}) to the range in ${file} (${field}), keeping all existing alternatives, then rerun.`,
    );
  }
}

/** Update only the catalog scalar, preserving YAML comments and quoting. */
export function bumpCatalog(
  yaml: string,
  name: string,
  version: string,
  catalog: string,
  peer = false,
): string {
  const doc = parseDocument(yaml);
  if (doc.errors.length) throw doc.errors[0];
  const path = catalog ? ['catalogs', catalog, name] : ['catalog', name];
  const before = doc.getIn(path);
  if (typeof before !== 'string') {
    assertIndependentYamlPin(doc, path);
    throw new Error(`catalog ${catalog || '(default)'} has no entry for ${name}`);
  }
  const after = declaredRange(before, version, 'pnpm-workspace.yaml', path.join('.'), name, peer);
  if (after === before) return yaml;
  assertIndependentYamlPin(doc, path);
  doc.setIn(path, after);
  return doc.toString();
}

/** The same rewrite as the writer, without touching files. `read` can read the committed ref. */
export function validateVersionRanges(
  root: string,
  moves: readonly { name: string; to: string }[],
  read = (file: string) => readFileSync(join(root, file), 'utf8'),
): void {
  for (const workspace of workspacePackagesOf(root)) {
    const file = join(workspace, 'package.json');
    const json = JSON.parse(read(file));
    for (const { name, to } of moves) {
      for (const section of sections) {
        const before = json[section]?.[name];
        if (typeof before !== 'string') continue;
        if (before.startsWith('catalog:'))
          bumpCatalog(
            read('pnpm-workspace.yaml'),
            name,
            to,
            before.slice(8),
            section === 'peerDependencies',
          );
        else
          declaredRange(
            before,
            to,
            file,
            `${section}.${name}`,
            name,
            section === 'peerDependencies',
          );
      }
    }
  }
}
export function bumpVersions(
  root: string,
  name: string,
  version: string,
): { files: string[]; workspaces: string[]; alreadyCompatible: string[] } {
  validateVersionRanges(root, [{ name, to: version }]);
  const files: string[] = [];
  const workspaces: string[] = [];
  const catalogs = new Map<string, boolean>();
  const alreadyCompatible: string[] = [];
  for (const workspace of workspacePackagesOf(root)) {
    const file = join(root, workspace, 'package.json');
    const original = readFileSync(file, 'utf8');
    const json = JSON.parse(original);
    let declared = false;
    let changed = false;
    for (const section of sections) {
      const before = json[section]?.[name];
      if (typeof before !== 'string') continue;
      declared = true;
      if (before.startsWith('catalog:')) {
        const catalog = before.slice('catalog:'.length);
        catalogs.set(catalog, catalogs.get(catalog) || section === 'peerDependencies');
        const yaml = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8');
        if (bumpCatalog(yaml, name, version, catalog, section === 'peerDependencies') === yaml)
          alreadyCompatible.push(`${workspace} (${section}.${name})`);
      } else {
        const after = declaredRange(
          before,
          version,
          relative(root, file),
          `${section}.${name}`,
          name,
          section === 'peerDependencies',
        );
        if (after === before) alreadyCompatible.push(`${workspace} (${section}.${name})`);
        else {
          json[section][name] = after;
          changed = true;
        }
      }
    }
    if (declared) workspaces.push(workspace);
    if (changed) {
      writeFileSync(
        file,
        `${JSON.stringify(json, null, original.match(/\n(\s+)"/)?.[1] ?? '  ')}\n`,
      );
      files.push(file);
    }
  }
  if (catalogs.size) {
    const file = join(root, 'pnpm-workspace.yaml');
    const original = readFileSync(file, 'utf8');
    let text = original;
    for (const [catalog, peer] of catalogs) text = bumpCatalog(text, name, version, catalog, peer);
    if (text !== original) {
      writeFileSync(file, text);
      files.push(file);
    }
  }
  if (!workspaces.length) throw new Error(`no workspace declares ${name}`);
  return { files, workspaces, alreadyCompatible };
}
/**
 * A `@types` stub the plan removes (`check/removed.ts`), taken out of every workspace that
 * installs it. A peer declaration is the package's promise to its consumers and stays.
 */
export function removeDeclarations(
  root: string,
  name: string,
): { files: string[]; workspaces: string[]; alreadyCompatible: string[] } {
  const files: string[] = [];
  const workspaces: string[] = [];
  for (const workspace of workspacePackagesOf(root)) {
    const file = join(root, workspace, 'package.json');
    const original = readFileSync(file, 'utf8');
    const json = JSON.parse(original);
    let changed = false;
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies'])
      if (typeof json[section]?.[name] === 'string') {
        delete json[section][name];
        changed = true;
      }
    if (!changed) continue;
    writeFileSync(file, `${JSON.stringify(json, null, original.match(/\n(\s+)"/)?.[1] ?? '  ')}\n`);
    files.push(file);
    workspaces.push(workspace);
  }
  return { files, workspaces, alreadyCompatible: [] };
}
/**
 * A lead the repository installs only through an alternate lead (`react-router` through
 * `react-router-dom`) is declared beside the alternate, at the target, in the same section
 * and range style, in each workspace that declares the alternate and not the lead: the
 * upgrade then moves both. Nothing is written when some workspace already declares the lead.
 * Returns the files written.
 */
export function declareLead(
  root: string,
  name: string,
  alternates: readonly string[],
  version: string,
): string[] {
  if (!alternates.length) return [];
  const manifests = workspacePackagesOf(root).map((workspace) => {
    const file = join(root, workspace, 'package.json');
    const text = readFileSync(file, 'utf8');
    return { file, text, json: JSON.parse(text) };
  });
  if (manifests.some(({ json }) => sections.some((s) => typeof json[s]?.[name] === 'string')))
    return [];
  const files: string[] = [];
  for (const { file, text, json } of manifests) {
    const section = (['dependencies', 'devDependencies', 'optionalDependencies'] as const).find(
      (s) => alternates.some((a) => typeof json[s]?.[a] === 'string'),
    );
    if (!section) continue;
    const alternate = alternates.find((a) => typeof json[section][a] === 'string') as string;
    const spec: string = json[section][alternate];
    if (/^(?:catalog|npm|workspace|link|file):/.test(spec))
      throw new UptideError(
        'UNSUPPORTED_VERSION_RANGE',
        `${relative(root, file)}: ${section}.${alternate} is ${JSON.stringify(spec)}; declare ${name} ${version} beside it by hand, then rerun.`,
      );
    const entries = Object.entries(json[section] as Record<string, string>);
    const keys = entries.map(([key]) => key);
    const sorted = keys.every((key, i) => i === 0 || (keys[i - 1] as string) <= key);
    entries.push([name, versionRange(spec, version)]);
    if (sorted) entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    json[section] = Object.fromEntries(entries);
    writeFileSync(file, `${JSON.stringify(json, null, text.match(/\n(\s+)"/)?.[1] ?? '  ')}\n`);
    files.push(file);
  }
  return files;
}

export async function install(root: string, upgrade?: Upgrade): Promise<InstallReport | undefined> {
  if (upgrade) return isolatedUpgrade(root, upgrade);
  const pm = await assertManagerAvailable(root);
  const lockfile = join(root, pm.lockfile);
  const before = readFileSync(lockfile);
  const result = await command(root, pm.bin, pm.args, 300_000, pm.env);
  if (!readFileSync(lockfile).equals(before)) {
    writeFileSync(lockfile, before);
    throw new UptideError(
      'LOCKFILE_OUT_OF_SCOPE',
      'Frozen install changed the lockfile; the original was restored.',
    );
  }
  if (result.code)
    throw new UptideError(
      'INSTALL_FAILED',
      `install failed${result.timeout ? ' (timeout)' : ''}: ${result.output}`,
    );
}
