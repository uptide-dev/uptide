import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { Project, ts } from 'ts-morph';
import { resolveCompiler } from '../adapters/typescript/compiler.js';
import { readInstalled } from '../adapters/typescript/repo.js';
import { workspaceSourceMap } from '../adapters/typescript/workspace-source.js';
import { command } from './process.js';
import { isServiceTest, serviceNeeds, unitConfig } from './services.js';
import type { FixDiagnostic, RelatedDeclaration, TestResult } from './types.js';

/** Only compiler-linked, repository-owned property/parameter declarations extend edit scope. */
function relatedDeclarations(
  root: string,
  compiler: typeof ts,
  d: ts.Diagnostic,
): RelatedDeclaration[] {
  return (d.relatedInformation ?? []).flatMap((info) => {
    if (
      info.code !== 6500 ||
      !info.file ||
      info.start === undefined ||
      !existsSync(info.file.fileName) ||
      info.file.fileName.split('/').includes('node_modules')
    )
      return [];
    const file = relative(realpathSync(root), realpathSync(info.file.fileName));
    if (
      isAbsolute(file) ||
      file === '..' ||
      file.startsWith('../') ||
      file.split('/').includes('node_modules')
    )
      return [];
    const start = info.start;
    let declaration: ts.Node | undefined;
    const visit = (node: ts.Node) => {
      if (start < node.getStart(info.file) || start >= node.end) return;
      if (
        compiler.isPropertySignature(node) ||
        compiler.isPropertyDeclaration(node) ||
        compiler.isParameter(node)
      )
        declaration = node;
      compiler.forEachChild(node, visit);
    };
    visit(info.file);
    if (!declaration) return [];
    return [
      {
        file,
        line: info.file.getLineAndCharacterOfPosition(declaration.getStart(info.file)).line + 1,
        endLine: info.file.getLineAndCharacterOfPosition(declaration.end).line + 1,
        message: compiler.flattenDiagnosticMessageText(info.messageText, '\n'),
      },
    ];
  });
}

let bundledLibraries: Map<string, string> | undefined;
function bundledHost(options: ts.CompilerOptions): ts.CompilerHost {
  if (!bundledLibraries?.has(ts.getDefaultLibFileName(options))) {
    const project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: { target: options.target ?? ts.ScriptTarget.ES2025 },
    });
    project.createSourceFile('probe.ts', 'const value = 1;');
    bundledLibraries = new Map(
      project
        .getProgram()
        .compilerObject.getSourceFiles()
        .filter((f) => f.fileName.includes('/typescript/lib/'))
        .map((f) => [basename(f.fileName), f.text]),
    );
  }
  const host = ts.createCompilerHost(options);
  const read = host.readFile,
    exists = host.fileExists;
  const lib = (file: string) =>
    file.startsWith('/__uptide_lib__/') ? bundledLibraries?.get(basename(file)) : undefined;
  host.readFile = (file) => lib(file) ?? read(file);
  host.fileExists = (file) => lib(file) !== undefined || exists(file);
  host.getDefaultLibLocation = () => '/__uptide_lib__';
  host.getDefaultLibFileName = (o) => join('/__uptide_lib__', ts.getDefaultLibFileName(o));
  host.getSourceFile = (file, languageVersion) => {
    const text = host.readFile(file);
    return text === undefined ? undefined : ts.createSourceFile(file, text, languageVersion, true);
  };
  return host;
}

/** Fresh programs after every edit; workspace dependencies resolve from source through loadRepo. */
/**
 * What a TS2322/TS2345 asked for, as a shape: the contextual type at the offending
 * expression, its properties one level deep with aliases expanded. `Type 'string' is not
 * assignable to type 'BillingCycleAnchor'` says nothing a migration can use;
 * `{ type: "now" | "unchanged" | OtherString }` does. Best effort against the repository's
 * own compiler: anything it cannot answer is simply absent.
 */
function expectedShape(
  compiler: typeof ts,
  program: ts.Program,
  d: ts.Diagnostic,
): string | undefined {
  if (!d.file || d.start === undefined || ![2322, 2345].includes(d.code)) return undefined;
  try {
    const checker = program.getTypeChecker();
    let node: ts.Node | undefined;
    const visit = (n: ts.Node): void => {
      if (n.getStart() <= (d.start as number) && (d.start as number) < n.getEnd()) {
        node = n;
        n.forEachChild(visit);
      }
    };
    d.file.forEachChild(visit);
    // The expression the type was wanted for: the initializer of the property named at the
    // error, or the argument the error points at.
    let expression: ts.Node | undefined = node;
    while (expression && !compiler.isExpression(expression)) expression = expression.parent;
    if (expression && compiler.isPropertyAssignment(expression.parent))
      expression = expression.parent.initializer;
    if (!expression || !compiler.isExpression(expression)) return undefined;
    const type = checker.getContextualType(expression);
    if (!type) return undefined;
    const flags = compiler.TypeFormatFlags.NoTruncation | compiler.TypeFormatFlags.InTypeAlias;
    // `import("/.../stripe/esm/shared").OtherString` is `OtherString` to a reader.
    const plain = (text: string): string => text.replace(/import\("[^"]*"\)\./g, '');
    const print = (t: ts.Type, f = flags): string => plain(checker.typeToString(t, expression, f));
    // An optional property's contextual type carries `undefined`; the property does not.
    const parts = (type.isUnion() ? type.types : [type]).filter(
      (t) => !(t.flags & compiler.TypeFlags.Undefined),
    );
    const members = (t: ts.Type): string | undefined => {
      const props = t.getProperties();
      if (props.length === 0 || props.length > 12) return undefined;
      return `{ ${props
        .map((p) => {
          const optional = p.flags & compiler.SymbolFlags.Optional ? '?' : '';
          const own = checker.getTypeOfSymbolAtLocation(p, expression as ts.Node);
          return `${p.name}${optional}: ${print(own).replace(/ \| undefined$/, '')}`;
        })
        .join('; ')} }`;
    };
    const name = parts.map((t) => print(t, compiler.TypeFormatFlags.NoTruncation)).join(' | ');
    const shape = parts.map((t) => members(t) ?? print(t)).join(' | ');
    if (shape === name) return undefined;
    return `${name}: ${shape}`.slice(0, 600);
  } catch {
    return undefined;
  }
}

/** What one workspace's last check found, and what it was computed from. */
interface CheckedWorkspace {
  dir: string;
  compiler: typeof ts;
  host?: ts.CompilerHost;
  builder?: ts.SemanticDiagnosticsBuilderProgram;
  rootNames: string[];
  /** Repository source files in the program, as they read when checked. */
  seen: Map<string, string>;
  result?: { diagnostics: FixDiagnostic[]; discovered: string[] };
}
/**
 * A source file the builder can compare across checks: the same object while its text is the
 * same, with the version the builder needs. Files outside the repository and in node_modules
 * do not change during a run and are read once.
 */
function remembering(host: ts.CompilerHost, root: string): ts.CompilerHost {
  const cache = new Map<string, ts.SourceFile>();
  const create = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, language, onError, shouldCreate) => {
    const hit = cache.get(fileName);
    const fixed = !fileName.startsWith(`${root}/`) || fileName.includes('/node_modules/');
    if (hit && (fixed || host.readFile(fileName) === hit.text)) return hit;
    const file = create(fileName, language, onError, shouldCreate);
    if (file) {
      (file as { version?: string }).version = createHash('sha1').update(file.text).digest('hex');
      cache.set(fileName, file);
    }
    return file;
  };
  return host;
}
const unchanged = (seen: Map<string, string>): boolean =>
  [...seen].every(([file, text]) => existsSync(file) && readFileSync(file, 'utf8') === text);

/** One workspace, re-checked only when a repository file its program reads has changed. */
function checkWorkspace(root: string, workspace: string, state: CheckedWorkspace) {
  const { dir, compiler } = state;
  const tsconfig = join(dir, 'tsconfig.json');
  const config = compiler.readConfigFile(tsconfig, compiler.sys.readFile);
  const parsed = compiler.parseJsonConfigFileContent(
    config.config ?? {
      include: ['**/*.ts', '**/*.tsx'],
      exclude: ['node_modules', 'dist', 'build'],
    },
    compiler.sys,
    dir,
    undefined,
    config.config ? tsconfig : undefined,
  );
  const sources = workspaceSourceMap(dir, readInstalled(dir).installed);
  const fileNames = new Set(parsed.fileNames);
  for (const reference of parsed.projectReferences ?? []) {
    const path = reference.path.endsWith('.json')
      ? reference.path
      : join(reference.path, 'tsconfig.json');
    const ref = compiler.readConfigFile(path, compiler.sys.readFile);
    const files = compiler.parseJsonConfigFileContent(
      ref.config ?? {},
      compiler.sys,
      dirname(path),
    ).fileNames;
    for (const f of files) fileNames.add(f);
  }
  const rootNames = [...fileNames];
  if (
    state.result &&
    rootNames.length === state.rootNames.length &&
    rootNames.every((f, i) => f === state.rootNames[i]) &&
    unchanged(state.seen)
  )
    return state.result;
  if (compiler === ts) parsed.options.ignoreDeprecations = '6.0';
  if (!state.host) {
    const hostOptions = { ...parsed.options, noEmit: true, skipLibCheck: true };
    const host =
      compiler === ts ? bundledHost(hostOptions) : compiler.createCompilerHost(hostOptions);
    // Type roots and `types` resolve from the workspace, as its own `tsc` would; from the
    // process's directory, an isolated pnpm layout sees no @types at all.
    host.getCurrentDirectory = () => dir;
    state.host = remembering(host, root);
  }
  const builder = compiler.createSemanticDiagnosticsBuilderProgram(
    rootNames,
    {
      ...parsed.options,
      noEmit: true,
      rootDir: root,
      composite: false,
      incremental: false,
      paths: { ...parsed.options.paths, ...sources.paths },
    },
    state.host,
    state.builder,
  );
  // The builder refreshes what it remembers per file only while its affected files are walked:
  // the changed files and every file whose types depend on them. Then per-file answers hold.
  while (builder.getSemanticDiagnosticsOfNextAffectedFile());
  const program = builder.getProgram();
  const errors = [
    ...parsed.errors,
    ...(config.error ? [config.error] : []),
    ...builder.getOptionsDiagnostics(),
    ...builder.getGlobalDiagnostics(),
  ];
  const discovered: string[] = [];
  const seen = new Map<string, string>();
  for (const file of program.getSourceFiles()) {
    if (
      file.isDeclarationFile ||
      !file.fileName.startsWith(`${root}/`) ||
      file.fileName.includes('/node_modules/')
    )
      continue;
    seen.set(file.fileName, file.text);
    // Source dependencies provide types to this program, but their implementation
    // diagnostics belong to their own tsconfig (module resolution may differ).
    let owner = dirname(file.fileName);
    while (owner !== root && !existsSync(join(owner, 'tsconfig.json'))) owner = dirname(owner);
    if (owner !== dir && owner !== root) {
      discovered.push(relative(root, owner));
      continue;
    }
    errors.push(...builder.getSyntacticDiagnostics(file), ...builder.getSemanticDiagnostics(file));
  }
  const found: FixDiagnostic[] = [];
  for (const d of errors) {
    if (d.category !== ts.DiagnosticCategory.Error) continue;
    const location = d.file?.getLineAndCharacterOfPosition(d.start ?? 0);
    const expected = expectedShape(compiler, program, d);
    const related = relatedDeclarations(root, compiler, d);
    const relatedLocations = (d.relatedInformation ?? []).flatMap((info) => {
      if (!info.file || info.start === undefined) return [];
      const at = info.file.getLineAndCharacterOfPosition(info.start);
      return [
        { file: relative(root, info.file.fileName), line: at.line + 1, column: at.character + 1 },
      ];
    });
    found.push({
      file: d.file ? relative(root, d.file.fileName) : join(workspace, 'tsconfig.json'),
      line: (location?.line ?? 0) + 1,
      column: (location?.character ?? 0) + 1,
      code: d.code,
      message: ts.flattenDiagnosticMessageText(d.messageText, '\n').split(root).join('<repo>'),
      ...(expected ? { expected } : {}),
      ...(related.length ? { relatedDeclarations: related } : {}),
      ...(relatedLocations.length ? { relatedLocations } : {}),
    });
  }
  Object.assign(state, { builder, rootNames, seen, result: { diagnostics: found, discovered } });
  return { diagnostics: found, discovered };
}

/**
 * The repository's type errors, checked again on demand: each workspace keeps its program
 * between checks and is re-checked only when a repository file it reads changed, and then
 * only the files that change can affect. `--agent sdk` checks after every task with one.
 */
export function typeChecker(root: string, workspaces: string[]): { check(): FixDiagnostic[] } {
  const states = new Map<string, CheckedWorkspace>();
  return {
    check() {
      const all = new Map<string, FixDiagnostic>();
      const queue = [...workspaces];
      const visited = new Set<string>();
      for (const workspace of queue) {
        if (visited.has(workspace)) continue;
        visited.add(workspace);
        const dir = join(root, workspace);
        let state = states.get(workspace);
        if (!state) {
          state = { dir, compiler: resolveCompiler(dir), rootNames: [], seen: new Map() };
          states.set(workspace, state);
        }
        const { diagnostics: found, discovered } = checkWorkspace(root, workspace, state);
        for (const other of discovered) if (!visited.has(other)) queue.push(other);
        for (const value of found)
          all.set(
            `${value.file}:${value.line}:${value.column}:${value.code}:${value.message}`,
            value,
          );
      }
      return [...all.values()].sort(
        (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column,
      );
    },
  };
}

export function diagnostics(root: string, workspaces: string[]): FixDiagnostic[] {
  return typeChecker(root, workspaces).check();
}
/** "Cannot find type definition file / module / name": the codes a missing package produces. */
const RESOLUTION_CODES = new Set([2307, 2580, 2581, 2582, 2591, 2592, 2593, 2688, 2792]);

/** The packages whose absence a diagnostic describes, by the names they could be installed under. */
export function missingPackages(d: FixDiagnostic): string[] {
  if (!RESOLUTION_CODES.has(d.code)) return [];
  // "Cannot find name 'Buffer'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node`"
  const suggested = /@types\/[\w.-]+/.exec(d.message)?.[0];
  if (suggested) return [suggested];
  const name = /'([^']+)'/.exec(d.message)?.[1];
  if (!name || name.startsWith('.') || name.startsWith('/')) return [];
  if (name.startsWith('node:') || builtinModules.includes(name)) return ['@types/node'];
  const pkg = name
    .split('/')
    .slice(0, name.startsWith('@') ? 2 : 1)
    .join('/');
  const types = `@types/${pkg.startsWith('@') ? pkg.slice(1).replace('/', '__') : pkg}`;
  // A type definition file is looked up under @types first; a module, under its own name.
  return d.code === 2688 ? [types, pkg] : [pkg, types];
}

/**
 * Why the baseline's types cannot be trusted, if they cannot: errors that say a package is
 * missing while the workspace declares it and has it installed. Those are the compiler not
 * seeing the install (a resolution the repository's own `tsc` does not share), and every
 * error that depends on the package is then hidden on both sides of the comparison.
 */
export function typeResolutionFailure(root: string, baseline: FixDiagnostic[]): string | undefined {
  const seen = new Set<string>();
  let errors = 0;
  for (const d of baseline) {
    const candidates = missingPackages(d);
    if (candidates.length === 0) continue;
    let declared = false;
    let installed: string | undefined;
    for (let dir = dirname(join(root, d.file)); ; dir = dirname(dir)) {
      const manifest = existsSync(join(dir, 'package.json'))
        ? (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Record<string, unknown>)
        : {};
      for (const name of candidates) {
        declared ||= ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
          .map((field) => manifest[field] as Record<string, string> | undefined)
          .some((deps) => deps?.[name] !== undefined);
        if (!installed && existsSync(join(dir, 'node_modules', name, 'package.json')))
          installed = name;
      }
      if (dir === root || dirname(dir) === dir) break;
    }
    if (declared && installed) {
      errors++;
      seen.add(installed);
    }
  }
  if (errors === 0) return undefined;
  const names = [...seen].sort();
  return `${errors} baseline error${errors === 1 ? '' : 's'} cannot see ${names.join(', ')}, which ${names.length === 1 ? 'is' : 'are'} declared and installed`;
}

export function diagnosticKey(d: FixDiagnostic): string {
  const position = (at: { file: string; line: number; column: number }) => [
    at.file,
    at.line,
    at.column,
  ];
  return JSON.stringify([position(d), d.code, (d.relatedLocations ?? []).map(position).sort()]);
}
/** Identity without position: what an error keeps when lines above it move. */
export const unplacedKey = (d: Pick<FixDiagnostic, 'file' | 'code' | 'message'>): string =>
  JSON.stringify([d.file, d.code, d.message.split('\n')[0]]);
/**
 * `newDiagnostics`, then an error that only moved is not new: one with the same file, code and
 * first message line as a baseline error no longer at its position. `--agent sdk` only, whose
 * whole-file edits shift every line below them.
 */
export function newDiagnosticsAcrossShifts(
  baseline: FixDiagnostic[],
  target: FixDiagnostic[],
): FixDiagnostic[] {
  const moved = new Map<string, number>();
  for (const d of newDiagnostics(target, baseline))
    moved.set(unplacedKey(d), (moved.get(unplacedKey(d)) ?? 0) + 1);
  return newDiagnostics(baseline, target).filter((d) => {
    const n = moved.get(unplacedKey(d)) ?? 0;
    if (n) moved.set(unplacedKey(d), n - 1);
    return n === 0;
  });
}
/** Position and code identify an error even when TypeScript expands its message chain. */
export function newDiagnostics(
  baseline: FixDiagnostic[],
  target: FixDiagnostic[],
): FixDiagnostic[] {
  const counts = new Map<string, number>();
  for (const d of baseline) counts.set(diagnosticKey(d), (counts.get(diagnosticKey(d)) ?? 0) + 1);
  return target.filter((d) => {
    const n = counts.get(diagnosticKey(d)) ?? 0;
    if (n) {
      counts.set(diagnosticKey(d), n - 1);
      return false;
    }
    return true;
  });
}
/** One test run `fix` will make: where, with what, and how to describe it in the report. */
export interface TestPlan {
  /** The workspace the result is reported under: its own path, or the directory of a shared config. */
  workspace: string;
  /** Workspaces this run answers for. */
  covers: string[];
  cwd: string;
  /** The command as a person would type it from `cwd`. */
  command: string;
  /** How the scope was chosen, in words for the report. */
  scope: string;
  /** A file the run needs and that is removed afterwards: the unit-only runner configuration. */
  write?: { path: string; text: string };
  /** Integration and end-to-end test files left out because they need services. */
  notRun?: { files: number; needs: string[] };
  /**
   * The repository's own `test` script, run instead when the runner command fails without a
   * failing test to show for it (it could not start): a flag it does not take, a config error.
   */
  fallback?: string;
  /** With `withServices`: what the run connects to. */
  services?: { names: string[]; targets: string[] };
}

export interface TestOptions {
  /**
   * Also run tests that need a database, a cache or a queue, with the repository's global
   * setup. Off by default: such a setup connects to whatever the environment points at and
   * may reset it, and verification must not touch the user's services uninvited.
   */
  withServices?: boolean;
  /**
   * Only what can see `files`: the workspaces that own one and those that depend on them,
   * and a script that is just the runner (`vitest run`, `jest`) in its related-tests mode.
   * For the agent's own checks between tasks; verification runs the full selection.
   */
  related?: boolean;
}

const VITEST_CONFIGS = ['vitest.config', 'vitest.workspace'].flatMap((base) =>
  ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs'].map((ext) => `${base}.${ext}`),
);
const JEST_CONFIGS = ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs', 'json'].map(
  (ext) => `jest.config.${ext}`,
);
const quote = (arg: string): string =>
  /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`;

function manifest(dir: string):
  | {
      name?: string;
      scripts?: Record<string, string>;
      jest?: unknown;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    }
  | undefined {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  } catch {
    return undefined;
  }
}

/** Directories from `from` up to `root`, nearest first. */
function upTo(root: string, from: string): string[] {
  const dirs: string[] = [];
  for (let dir = from; ; dir = dirname(dir)) {
    dirs.push(dir);
    if (dir === root || dirname(dir) === dir) break;
  }
  return dirs;
}

/** The nearest vitest or jest configuration covering a workspace, with a runner installed for it. */
function runnerFor(
  root: string,
  workspace: string,
): { runner: 'vitest' | 'jest'; dir: string; config: string } | undefined {
  for (const dir of upTo(root, join(root, workspace))) {
    const installed = (bin: string): boolean =>
      upTo(root, dir).some((d) => existsSync(join(d, 'node_modules/.bin', bin)));
    const vitest = VITEST_CONFIGS.find((name) => existsSync(join(dir, name)));
    if (vitest && installed('vitest')) return { runner: 'vitest', dir, config: vitest };
    const jest =
      JEST_CONFIGS.find((name) => existsSync(join(dir, name))) ??
      (manifest(dir)?.jest ? 'package.json' : undefined);
    if (jest && installed('jest')) return { runner: 'jest', dir, config: jest };
  }
  return undefined;
}

/** The workspaces that own one of `files`, and those that depend on one of them by name. */
function relatedWorkspaces(root: string, workspaces: string[], files: string[]): string[] {
  const owner = (file: string) =>
    workspaces
      .filter((w) => w === '.' || file.startsWith(`${w}/`))
      .sort((a, b) => b.length - a.length)[0];
  const owners = new Set(files.map(owner).filter((w): w is string => w !== undefined));
  const names = new Set(
    [...owners].map((w) => manifest(join(root, w))?.name).filter((n): n is string => !!n),
  );
  return workspaces.filter((w) => {
    if (owners.has(w)) return true;
    // The root's script usually runs every workspace's (`pnpm -r test`): only its own files ask for it.
    if (w === '.') return false;
    const m = manifest(join(root, w));
    return Object.keys({ ...m?.dependencies, ...m?.devDependencies }).some((d) => names.has(d));
  });
}

/** A `test` script that is only the runner, run in related-tests mode on `files`. */
function relatedScript(
  root: string,
  workspace: string,
  script: string | undefined,
  files: string[],
): TestPlan | undefined {
  const runner = /^\s*(?:(?:npx|pnpm exec|yarn)\s+)?(vitest(?:\s+run)?|jest)\s*$/.exec(
    script ?? '',
  )?.[1];
  const dir = join(root, workspace);
  const bin = runner?.startsWith('vitest') ? 'vitest' : runner;
  if (!bin || !upTo(root, dir).some((d) => existsSync(join(d, 'node_modules/.bin', bin))))
    return undefined;
  const paths = files
    .filter((f) => existsSync(join(root, f)))
    .map((f) => relative(dir, join(root, f)));
  if (!paths.length) return undefined;
  const args =
    bin === 'vitest'
      ? ['related', '--run', '--passWithNoTests', ...paths]
      : ['--findRelatedTests', ...paths, '--passWithNoTests'];
  return {
    workspace,
    covers: [workspace],
    cwd: dir,
    command: [bin, ...args.map(quote)].join(' '),
    scope: `${bin} tests related to ${paths.length} changed file${paths.length === 1 ? '' : 's'} (its \`test\` script is the runner)`,
  };
}

/**
 * The same detection for every run, baseline and target alike. Per workspace, in order: its
 * own `test` script; a vitest or jest configuration that covers it (its own or an ancestor's,
 * as in a monorepo with one root config), scoped to the affected files with the runner's
 * related-tests mode, or to the workspace directory when no file is known; the root `test`
 * script. Workspaces sharing a configuration share one run. Whatever is left has no tests.
 */
export function planTests(
  root: string,
  workspaces: string[],
  files: string[] = [],
  options: TestOptions = {},
): TestPlan[] {
  const plans: TestPlan[] = [];
  const shared = new Map<
    string,
    { runner: 'vitest' | 'jest'; dir: string; config: string; covers: string[] }
  >();
  const rootScript: string[] = [];
  const selected = options.related ? relatedWorkspaces(root, workspaces, files) : workspaces;
  for (const workspace of selected) {
    const script = manifest(join(root, workspace))?.scripts?.test;
    const scoped =
      options.related && files.length ? relatedScript(root, workspace, script, files) : undefined;
    if (scoped) {
      plans.push(scoped);
      continue;
    }
    // A script that is just the runner is planned as the runner: scoped, and classified.
    const bare = /^\s*(?:(?:npx|pnpm exec|yarn)\s+)?(vitest|jest)\b/.exec(script ?? '')?.[1];
    if (script && !(bare && runnerFor(root, workspace)?.runner === bare)) {
      plans.push({
        workspace,
        covers: [workspace],
        cwd: join(root, workspace),
        command: script,
        scope: `the \`test\` script of ${workspace === '.' ? 'the repository' : workspace}`,
      });
      continue;
    }
    const found = runnerFor(root, workspace);
    if (found) {
      const key = `${found.runner}:${found.dir}`;
      const group = shared.get(key) ?? { ...found, covers: [] };
      group.covers.push(workspace);
      shared.set(key, group);
      continue;
    }
    if (workspace !== '.' && manifest(root)?.scripts?.test) rootScript.push(workspace);
    else
      plans.push({
        workspace,
        covers: [workspace],
        cwd: join(root, workspace),
        command: '',
        scope: 'no test script, and no vitest or jest configuration covers this workspace',
      });
  }
  for (const group of shared.values()) {
    const inside = (file: string): boolean =>
      group.covers.some((w) => w === '.' || file === w || file.startsWith(`${w}/`));
    const related = [...new Set(files)]
      .filter(inside)
      .filter((file) => existsSync(join(root, file)))
      .map((file) => relative(group.dir, join(root, file)))
      .sort();
    const dirs = group.covers.map((w) => relative(group.dir, join(root, w)) || '.');
    const where = relative(root, join(group.dir, group.config)) || group.config;
    // Tests that need a database or a queue, and a global setup that connects to one, are
    // opt-in: by default only what runs without services runs.
    const needs = serviceNeeds(root, group.dir, group.config, group.covers);
    const sensitive = needs.files.length > 0 || needs.setups.length > 0;
    const unitOnly = sensitive && !options.withServices;
    const needsText = needs.services.length ? needs.services : ['services'];
    const workspace = relative(root, group.dir) || '.';
    const wrapper = 'vitest.uptide-unit.config.mjs';
    const canIsolate =
      group.runner === 'vitest'
        ? group.config.startsWith('vitest.config.')
        : needs.setups.length === 0;
    if (unitOnly && !canIsolate) {
      // The global setup cannot be taken out of this configuration: nothing runs, and it says so.
      plans.push({
        workspace,
        covers: group.covers,
        cwd: group.dir,
        command: '',
        scope: `not run: the ${group.runner} setup in ${where} connects to ${needsText.join(', ')}; pass --with-services to include it`,
        notRun: { files: needs.files.length, needs: needsText },
      });
      continue;
    }
    const targets = unitOnly ? related.filter((file) => !isServiceTest(file)) : related;
    const isolate = !unitOnly
      ? []
      : group.runner === 'vitest'
        ? ['--config', wrapper]
        : ['--testPathIgnorePatterns', '\\.(integration|int|e2e)\\.', '/(integration|e2e)/'];
    const under = dirs.filter((d) => d !== '.');
    // jest's --testPathIgnorePatterns takes every word after it: paths go first.
    const whole =
      group.runner === 'vitest'
        ? ['run', '--passWithNoTests', ...isolate, ...under]
        : ['--passWithNoTests', ...under, ...isolate];
    const args = !targets.length
      ? whole
      : group.runner === 'vitest'
        ? ['related', '--run', '--passWithNoTests', ...isolate, ...targets]
        : ['--findRelatedTests', ...targets, '--passWithNoTests', ...isolate];
    // Calling the runner directly skips npm's `pretest` hook. When the repository's own test
    // script is this runner, its `pretest` (typically a build of workspace packages the tests
    // import) is part of how the tests are meant to run, so it runs first, as a command of its
    // own and never through the lifecycle hook.
    const scripts = manifest(group.dir)?.scripts;
    const prepare =
      scripts?.pretest && new RegExp(`\\b${group.runner}\\b`).test(scripts.test ?? '')
        ? scripts.pretest
        : undefined;
    const run = [group.runner, ...args.map(quote)].join(' ');
    const kind = unitOnly ? 'unit tests' : 'tests';
    // When the related-tests command cannot start: the repository's own script, or, where
    // that would reach services, the same runner over the whole workspace, unit tests only.
    const script = unitOnly
      ? targets.length
        ? [group.runner, ...whole.map(quote)].join(' ')
        : undefined
      : (scripts?.test ?? manifest(root)?.scripts?.test);
    plans.push({
      workspace,
      covers: group.covers,
      cwd: group.dir,
      command: prepare ? `${prepare} && ${run}` : run,
      // A failing `pretest` fails the fallback too: it is what the tests import.
      ...(script ? { fallback: prepare ? `${prepare} && ${script}` : script } : {}),
      scope: `${
        targets.length
          ? `${group.runner} ${kind} related to ${targets.length} affected file${targets.length === 1 ? '' : 's'}`
          : `${group.runner} ${kind} under ${dirs.join(', ')}`
      }, ${where}${prepare ? ' after `pretest`' : ''}`,
      ...(unitOnly && group.runner === 'vitest'
        ? {
            write: {
              path: join(group.dir, wrapper),
              text: unitConfig(group.config, needs.setups.length > 0),
            },
          }
        : {}),
      ...(unitOnly ? { notRun: { files: needs.files.length, needs: needsText } } : {}),
      ...(sensitive && options.withServices
        ? { services: { names: needsText, targets: needs.targets } }
        : {}),
    });
  }
  if (rootScript.length)
    plans.push({
      workspace: '.',
      covers: rootScript,
      cwd: root,
      command: manifest(root)?.scripts?.test ?? '',
      scope: 'the `test` script of the repository',
    });
  return plans;
}

/** `270 tests in 41 files`, read from what vitest or jest printed; nothing when neither did. */
export function testSummary(output: string): string | undefined {
  const plain = output.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '');
  const tests = /^\s*Tests:?\s+(?:.*?,\s*)?(\d+) passed/m.exec(plain)?.[1];
  const files = /^\s*Test (?:Files|Suites):?\s+(?:.*?,\s*)?(\d+) passed/m.exec(plain)?.[1];
  if (!tests) return undefined;
  const n = Number(tests);
  return `${n} test${n === 1 ? '' : 's'}${files ? ` in ${files} file${files === '1' ? '' : 's'}` : ''}`;
}

/** Test files a vitest or jest run reports as failed, as the runner printed them. */
export function failedTestFiles(output: string): string[] {
  const files = new Set<string>();
  for (const line of output.split('\n')) {
    if (!/^\s*FAIL\b/.test(line)) continue;
    const file = /([\w@./-]+\.(?:test|spec)\.[cm]?[jt]sx?)/.exec(line)?.[1];
    if (file) files.add(file);
  }
  return [...files].sort();
}

const stem = (file: string): string =>
  (file.split('/').pop() ?? file).replace(
    /(?:\.(?:e2e|integration))?(?:\.(?:test|spec))?\.[cm]?[jt]sx?$/,
    '',
  );
/** Whether a failing test file is about one of the affected files: the file itself, or its test. */
function concerns(testFile: string, affected: string[]): boolean {
  return affected.some(
    (file) => file.endsWith(testFile) || testFile.endsWith(file) || stem(file) === stem(testFile),
  );
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g');
export async function testWorkspaces(
  root: string,
  workspaces: string[],
  timeoutMs = 120_000,
  files: string[] = [],
  options: TestOptions = {},
): Promise<TestResult[]> {
  const results: TestResult[] = [];
  let realRoot = root;
  try {
    realRoot = realpathSync(root);
  } catch {
    // The path as given is all there is.
  }
  for (const plan of planTests(root, workspaces, files, options)) {
    const described = {
      covers: plan.covers,
      scope: plan.scope,
      ...(plan.notRun ? { notRun: plan.notRun } : {}),
      ...(plan.services ? { services: plan.services } : {}),
    };
    if (!plan.command) {
      results.push({
        workspace: plan.workspace,
        status: 'missing',
        output: plan.scope,
        ...described,
      });
      continue;
    }
    const bins = upTo(root, plan.cwd)
      .map((dir) => join(dir, 'node_modules/.bin'))
      .filter((dir) => existsSync(dir));
    const attempt = (script = plan.command) =>
      command(plan.cwd, process.env.SHELL ?? '/bin/sh', ['-c', script], timeoutMs, {
        PATH: [...bins, process.env.PATH].join(':'),
      });
    // Stored and published as text: no terminal colors, no path of this machine.
    const plain = (text: string): string =>
      text.replace(ANSI, '').split(realRoot).join('<repo>').split(root).join('<repo>');
    if (plan.write) writeFileSync(plan.write.path, plan.write.text);
    let result: Awaited<ReturnType<typeof attempt>>;
    let retried: string[] = [];
    let ran = plan.command;
    let scope = plan.scope;
    try {
      result = await attempt();
      if (result.code && !result.timeout) {
        // A failure in a test that is not about the affected files gets one more run: a socket
        // reset in an unrelated e2e test must not fail a migration. A test of an affected file
        // that fails is ours, and is never retried into a pass.
        const failing = failedTestFiles(plain(result.output));
        if (failing.length > 0 && failing.every((file) => !concerns(file, files))) {
          const again = await attempt();
          if (!again.code && !again.timeout) retried = failing;
          result = again;
        }
        // Failed without a failing test: the command never ran the suite. The repository's own
        // script is the next honest answer, not "failed before the change".
        if (result.code && !result.timeout && failing.length === 0 && plan.fallback) {
          ran = plan.fallback;
          scope = `${plan.fallback}: the related-tests command failed before running a test`;
          result = await attempt(ran);
        }
      }
    } finally {
      // The unit-only configuration exists for the run alone.
      if (plan.write) rmSync(plan.write.path, { force: true });
    }
    const output = plain(result.output);
    const summary = testSummary(output);
    // The runner passed with nothing to run: that is "no tests", not a green suite.
    const empty =
      !result.code &&
      !result.timeout &&
      /No test files found|No tests found/i.test(output) &&
      !summary;
    results.push({
      workspace: plan.workspace,
      status: result.timeout ? 'timeout' : result.code ? 'failed' : empty ? 'missing' : 'passed',
      output: empty ? `no tests are related to the affected files (${ran})` : output,
      command: ran,
      ...described,
      scope,
      ...(summary ? { summary } : {}),
      ...(retried.length ? { retried } : {}),
    });
  }
  return results;
}

/**
 * What `--with-services` would reach in this repository, in words: the services, where they
 * are, and the setup that runs against them. Empty when no test needs a service.
 */
export function describeServices(root: string, workspaces: string[]): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const workspace of workspaces) {
    const found = runnerFor(root, workspace);
    if (!found || seen.has(`${found.runner}:${found.dir}`)) continue;
    seen.add(`${found.runner}:${found.dir}`);
    const needs = serviceNeeds(root, found.dir, found.config, workspaces);
    if (needs.files.length === 0 && needs.setups.length === 0) continue;
    const names = needs.services.length ? needs.services.join(', ') : 'services not identified';
    lines.push(
      `${names}: ${needs.files.length} integration or end-to-end test file${needs.files.length === 1 ? '' : 's'}${needs.setups.length ? `, global setup ${needs.setups.join(', ')} runs against it and may reset data` : ''}`,
      ...needs.targets.map((target) => `  ${target}`),
    );
  }
  return lines;
}

/**
 * Failures the migration did not cause: a workspace whose run failed before the change with
 * the same test files (or, when the runner names none, failed at all). They are marked, not
 * counted against verification; a new failing file is still a failure.
 */
export function markPreexisting(tests: TestResult[], baseline: TestResult[]): TestResult[] {
  return tests.map((t) => {
    if (t.status !== 'failed') return t;
    const before = baseline.find(
      (b) => b.workspace === t.workspace && (b.status === 'failed' || b.status === 'timeout'),
    );
    if (!before) return t;
    const now = failedTestFiles(t.output);
    const then = new Set(failedTestFiles(before.output));
    if (now.length === 0 && then.size === 0) return { ...t, preexisting: ['*'] };
    if (now.length > 0 && now.every((f) => then.has(f))) return { ...t, preexisting: now };
    return t;
  });
}
