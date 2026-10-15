import { type Dirent, existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { ts } from 'ts-morph';
import { automaticTypes } from '../../adapters/typescript/legacy-options.js';
import { type CompileProject, projectScope } from '../../adapters/typescript/project-scope.js';
import type { DownstreamSite, Finding } from '../../domain/report.js';

/**
 * TypeScript 6 defaults `types` to `[]`: the `@types` packages 5.x included on its own
 * (`@types/node`, `@types/jest`) are gone, and every use of their globals fails (`describe`,
 * `process`, `setTimeout`). A person fixes that with one line in the tsconfig, `"types": [...]`,
 * not at each use. So, as option cascades fold into their option (check/option-cascades.ts),
 * these errors fold into one `changed-defaults` finding at the tsconfig that compiles the file
 * and leaves `types` unset, and stand as its evidence.
 */

const NOTE = 'changed-defaults';

/** "Cannot find name 'x'. Do you need to install type definitions for node / a test runner / jQuery?" */
const TYPE_PACKAGE_HINT = new Set([2580, 2581, 2582, 2591, 2592, 2593]);
/** "Cannot find name 'x'" / "Cannot find namespace 'x'": folded only for a global an `@types` package declares. */
const MISSING_NAME = new Set([2304, 2503]);

const codeOf = (f: Finding): number =>
  f.usage.compileCode ?? Number(/^TS(\d+)$/.exec(f.change.path)?.[1] ?? 0);
const nameOf = (f: Finding): string | undefined =>
  /'([^']+)'/.exec(f.usage.compileError ?? '')?.[1];

interface Config {
  /** Absolute path. */
  file: string;
  /** `types` unset through the whole `extends` chain. */
  typesUnset: boolean;
  /** Globals the `@types` packages 5.x included for it declare. */
  globals: Set<string>;
}

/** Names declared in a package's `.d.ts` files: a heuristic over the text, not a type check. */
function declaredNames(dir: string, names: Set<string>, depth = 0): void {
  // ponytail: regex over declaration text; a global only a re-export brings in is missed, and its error stays a site.
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules' && depth < 4)
      declaredNames(path, names, depth + 1);
    else if (entry.isFile() && entry.name.endsWith('.d.ts'))
      for (const m of readFileSync(path, 'utf8').matchAll(
        /\b(?:function|var|let|const|class|namespace|interface)\s+([A-Za-z_$][\w$]*)/g,
      ))
        names.add(m[1] as string);
  }
}

function readConfig(file: string): Config | undefined {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    file,
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
  );
  if (!parsed) return undefined;
  const typesUnset = parsed.options.types === undefined;
  const globals = new Set<string>();
  if (typesUnset)
    for (const root of ts.getEffectiveTypeRoots(parsed.options, ts.sys) ?? [])
      for (const name of automaticTypes(parsed.options))
        if (existsSync(join(root, name))) declaredNames(join(root, name), globals);
  return { file, typesUnset, globals };
}

/** The projects that compile a file, ranked as the compile ranks owners (compile.ts). */
function ownersOf(projects: CompileProject[], file: string): CompileProject[] {
  const enclosing = (p: CompileProject): boolean => file.startsWith(`${dirname(p.config)}/`);
  const rank = (p: CompileProject): number =>
    enclosing(p) ? (basename(p.config) === 'tsconfig.json' ? 2 : 1) : 0;
  return projects
    .filter((p) => p.covers(file))
    .sort(
      (a, b) =>
        rank(b) - rank(a) ||
        (enclosing(b) ? dirname(b.config).length : 0) -
          (enclosing(a) ? dirname(a.config).length : 0),
    );
}

/** The line of the config's root object: where an option is added, as ground truth anchors an insertion. */
function rootLine(file: string): { line: number; snippet: string } {
  const text = readFileSync(file, 'utf8');
  const source = ts.parseJsonText(file, text);
  const root = source.statements[0]?.expression;
  const line = root ? source.getLineAndCharacterOfPosition(root.getStart(source)).line : 0;
  return { line: line + 1, snippet: (text.split('\n')[line] ?? '').trim() };
}

export function foldTypesDefault(input: {
  root: string;
  workspace: string;
  findings: Finding[];
}): Finding[] {
  // Real paths, as the project scope keeps them (`/var` is `/private/var` on macOS).
  const dir = realpathSync(resolve(input.root, input.workspace));
  const candidates = input.findings.filter((f) => {
    const code = codeOf(f);
    return f.rule === undefined && (TYPE_PACKAGE_HINT.has(code) || MISSING_NAME.has(code));
  });
  if (candidates.length === 0) return input.findings;
  const scope = projectScope({ dir, root: realpathSync(input.root) });
  const configs = new Map<string, Config | undefined>();
  const config = (file: string): Config | undefined => {
    if (!configs.has(file)) configs.set(file, readConfig(file));
    return configs.get(file);
  };
  const folded = new Map<string, Finding[]>();
  for (const f of candidates) {
    const name = nameOf(f);
    // The project whose compile the default broke: one covering the file that leaves `types`
    // unset (and, for a bare missing name, whose old @types declare it). A nearer project
    // that lists its types did not produce the error (Borewit's test/ lists mocha; the root
    // tsconfig, which compiles test/ too, does not, and is where the upgrade added it).
    const owner = ownersOf(scope.projects, resolve(dir, f.usage.file))
      .map((p) => config(p.config))
      .find(
        (c) =>
          c?.typesUnset &&
          (!MISSING_NAME.has(codeOf(f)) || (name !== undefined && c.globals.has(name))),
      );
    if (!owner) continue;
    folded.set(owner.file, [...(folded.get(owner.file) ?? []), f]);
  }
  if (folded.size === 0) return input.findings;
  const taken = new Set([...folded.values()].flat());
  const anchors = [...folded].map(([config, errors]): Finding => {
    const first = errors[0] as Finding;
    const file = relative(dir, config);
    const { line, snippet } = rootLine(config);
    const downstream: DownstreamSite[] = errors.map((e) => ({
      file: e.usage.file,
      line: e.usage.line,
      column: e.usage.column,
      snippet: e.usage.snippet,
      code: codeOf(e),
      message: e.usage.compileError ?? e.reason,
    }));
    const { compileError: _error, compileCode: _code, ...usage } = first.usage;
    const path = `${NOTE}:types`;
    const names = [...new Set(errors.map(nameOf).filter(Boolean))].slice(0, 6).join(', ');
    return {
      ...first,
      change: {
        ...first.change,
        path,
        kind: 'deprecated',
        severity: 'deprecated',
        source: 'pack',
        confidence: 1,
      },
      usage: {
        ...usage,
        file,
        line,
        column: 1,
        endLine: line,
        endColumn: 1,
        symbolPath: path,
        snippet,
        via: 'inferred',
      },
      severity: 'deprecated',
      confidence: 1,
      fixability: 'manual',
      rule: NOTE,
      anchorOnly: true,
      downstream,
      reason: `TypeScript 6 includes no @types package unless \`types\` lists it: ${errors.length} error${errors.length === 1 ? '' : 's'} in files ${file} compiles use their globals`,
      details: [
        `${errors.length} "Cannot find name" error${errors.length === 1 ? '' : 's'} (${names}) go with one edit here: list the @types packages the code uses in compilerOptions.types, or pin the 5.x behavior with ["*"]`,
      ],
    };
  });
  return [...input.findings.filter((f) => !taken.has(f)), ...anchors];
}
