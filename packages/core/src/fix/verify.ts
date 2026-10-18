import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { builtinModules } from 'node:module';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { ts } from 'ts-morph';
import { bundledLib } from '../adapters/typescript/compile.js';
import { resolveCompiler } from '../adapters/typescript/compiler.js';
import { readInstalled } from '../adapters/typescript/repo.js';
import { workspaceSourceMap } from '../adapters/typescript/workspace-source.js';
import { command, git } from './process.js';
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

/**
 * The bundled compiler's host for a repository without a compiler API (TypeScript 7): every
 * lib it names, `lib: ["ES2023"]` under an older target included, comes from ts-morph's copy.
 */
function bundledHost(options: ts.CompilerOptions): ts.CompilerHost {
  const host = ts.createCompilerHost(options);
  const read = host.readFile,
    exists = host.fileExists;
  const lib = (file: string) =>
    file.startsWith('/__uptide_lib__/')
      ? bundledLib(join('/node_modules/typescript/lib', basename(file)))
      : undefined;
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

/**
 * What a workspace's `tsc` compiles: its tsconfig, then each project it references, parsed
 * with `include`/`exclude` applied (JavaScript only under `allowJs`/`checkJs`). Without a
 * tsconfig, its TypeScript files. `projects[0]` is the workspace's own.
 */
export function workspaceProjects(
  compiler: typeof ts,
  dir: string,
): { config: ReturnType<typeof ts.readConfigFile>; projects: ts.ParsedCommandLine[] } {
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
  const projects = [parsed];
  for (const reference of parsed.projectReferences ?? []) {
    const path = reference.path.endsWith('.json')
      ? reference.path
      : join(reference.path, 'tsconfig.json');
    const ref = compiler.readConfigFile(path, compiler.sys.readFile);
    projects.push(
      compiler.parseJsonConfigFileContent(ref.config ?? {}, compiler.sys, dirname(path)),
    );
  }
  return { config, projects };
}

/** One workspace, re-checked only when a repository file its program reads has changed. */
function checkWorkspace(root: string, workspace: string, state: CheckedWorkspace) {
  const { dir, compiler } = state;
  const { config, projects } = workspaceProjects(compiler, dir);
  const parsed = projects[0] as ts.ParsedCommandLine;
  const sources = workspaceSourceMap(dir, readInstalled(dir).installed);
  const fileNames = new Set(projects.flatMap((p) => p.fileNames));
  // A file another tsconfig includes gets its diagnostics from that workspace's own check
  // (below), so it is not a root here: a root tsconfig that includes `packages/**` would
  // otherwise build the whole repository into one program (UPT-82). A file under another
  // tsconfig that does not include it (or does not parse) has no other check: it stays here.
  // Imports still pull claimed files in for types; declaration files stay roots for globals.
  const included = new Map<string, Set<string> | undefined>();
  const claimedBy = (file: string): string | undefined => {
    if (!file.startsWith(`${root}/`) || file.endsWith('.d.ts')) return undefined;
    let owner = dirname(file);
    while (owner !== root && owner !== dir && !existsSync(join(owner, 'tsconfig.json')))
      owner = dirname(owner);
    if (owner === root || owner === dir) return undefined;
    if (!included.has(owner)) {
      const path = join(owner, 'tsconfig.json');
      const own = compiler.readConfigFile(path, compiler.sys.readFile);
      included.set(
        owner,
        own.error || !own.config
          ? undefined
          : new Set(
              compiler.parseJsonConfigFileContent(own.config, compiler.sys, owner, undefined, path)
                .fileNames,
            ),
      );
    }
    return included.get(owner)?.has(file) ? owner : undefined;
  };
  const rootNames: string[] = [];
  const discovered = new Set<string>();
  for (const file of fileNames) {
    const owner = claimedBy(file);
    if (owner) discovered.add(relative(root, owner));
    else rootNames.push(file);
  }
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
    const owner = claimedBy(file.fileName);
    if (owner) {
      discovered.add(relative(root, owner));
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
  Object.assign(state, {
    builder,
    rootNames,
    seen,
    result: { diagnostics: found, discovered: [...discovered] },
  });
  return { diagnostics: found, discovered: [...discovered] };
}

/**
 * The repository's type errors, checked again on demand: each workspace keeps its program
 * between checks and is re-checked only when a repository file it reads changed, and then
 * only the files that change can affect. `--agent sdk` checks after every task with one.
 */
export function typeChecker(
  root: string,
  workspaces: string[],
  { retain = true }: { retain?: boolean } = {},
): { check(): FixDiagnostic[]; clear(): void } {
  const states = new Map<string, CheckedWorkspace>();
  return {
    clear: () => states.clear(),
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
        // A one-shot check holds one workspace's program at a time, not all of them (UPT-82).
        if (!retain) states.delete(workspace);
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
  return typeChecker(root, workspaces, { retain: false }).check();
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
/** Position and code identify an error even when TypeScript expands its message chain. */
export function newDiagnostics(
  baseline: FixDiagnostic[],
  target: FixDiagnostic[],
  moves?: LineMoves,
): FixDiagnostic[] {
  const counts = new Map<string, number>();
  for (const d of baseline) {
    const key = diagnosticKey(moved(d, moves));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return target.filter((d) => {
    const n = counts.get(diagnosticKey(d)) ?? 0;
    if (n) {
      counts.set(diagnosticKey(d), n - 1);
      return false;
    }
    return true;
  });
}

/**
 * Per edited file, where each line the edit kept now is (old line → new line). An import
 * added above an error moves it down a line without touching it: through this map the error
 * is the one that was there before, not a new one.
 */
export type LineMoves = Map<string, Map<number, number>>;

/** A diagnostic from before an edit, at the line it is on after it. Edited lines stay put. */
export function moved(d: FixDiagnostic, moves?: LineMoves): FixDiagnostic {
  if (!moves?.size) return d;
  const at = <T extends { file: string; line: number }>(p: T): T => {
    const line = moves.get(p.file)?.get(p.line);
    return line === undefined ? p : { ...p, line };
  };
  return {
    ...at(d),
    ...(d.relatedLocations ? { relatedLocations: d.relatedLocations.map(at) } : {}),
  };
}

/**
 * Line moves of edited files: the common head and tail, and the longest common subsequence
 * of the lines between (when that middle is small enough to compare line by line; a larger
 * one keeps only head and tail, so an error inside it counts as new, the safe side).
 */
export function lineMoves(
  changes: Iterable<[file: string, before: string, after: string]>,
): LineMoves {
  const moves: LineMoves = new Map();
  for (const [file, beforeText, afterText] of changes) {
    if (beforeText === afterText) continue;
    const a = beforeText.split('\n');
    const b = afterText.split('\n');
    const map = new Map<number, number>();
    let head = 0;
    while (head < a.length && head < b.length && a[head] === b[head]) {
      map.set(head + 1, head + 1);
      head++;
    }
    let tail = 0;
    while (
      tail < a.length - head &&
      tail < b.length - head &&
      a[a.length - 1 - tail] === b[b.length - 1 - tail]
    ) {
      map.set(a.length - tail, b.length - tail);
      tail++;
    }
    const x = a.slice(head, a.length - tail);
    const y = b.slice(head, b.length - tail);
    if (x.length && y.length && x.length * y.length <= 4_000_000) {
      // lcs[i][j]: the longest common subsequence of x[i..] and y[j..].
      const lcs = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
      for (let i = x.length - 1; i >= 0; i--)
        for (let j = y.length - 1; j >= 0; j--)
          (lcs[i] as Uint32Array)[j] =
            x[i] === y[j]
              ? ((lcs[i + 1] as Uint32Array)[j + 1] as number) + 1
              : Math.max(
                  (lcs[i + 1] as Uint32Array)[j] as number,
                  (lcs[i] as Uint32Array)[j + 1] as number,
                );
      for (let i = 0, j = 0; i < x.length && j < y.length; ) {
        if (x[i] === y[j]) {
          map.set(head + i + 1, head + j + 1);
          i++;
          j++;
        } else if (
          ((lcs[i + 1] as Uint32Array)[j] as number) >= ((lcs[i] as Uint32Array)[j + 1] as number)
        )
          i++;
        else j++;
      }
    }
    moves.set(file, map);
  }
  return moves;
}

/** Line moves of every file the working tree changed since `base` (a commit). */
export function gitLineMoves(root: string, base: string): LineMoves {
  let files: string[] = [];
  try {
    files = git(root, 'diff', '--name-only', base).split('\n').filter(Boolean);
  } catch {
    return new Map();
  }
  const changes: [string, string, string][] = [];
  for (const file of files) {
    try {
      // Untrimmed: `git()` trims, and a file's first and last lines are lines too.
      const before = execFileSync('git', ['show', `${base}:${file}`], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 1 << 28,
        timeout: 60_000,
        killSignal: 'SIGKILL',
      });
      changes.push([file, before, readFileSync(join(root, file), 'utf8')]);
    } catch {
      // Added or deleted: no line of it was there before and is still there.
    }
  }
  return lineMoves(changes);
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
  /** With `withServices`: what the run connects to. */
  services?: { names: string[]; targets: string[] };
  /**
   * What runs when this scoped run (the runner's related tests) fails: the repository's own
   * `test` script, or, when tests that need services are left out, the same runner over the
   * whole suite with them still left out. A related-tests command can fail for reasons that
   * are not a test (an argument the runner reads differently), and "failed before the change"
   * must not rest on that.
   */
  fallback?: { command: string; scope: string };
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
   * For the agent's own checks between tasks; never widens to the full suite on no matches.
   * Final verification runs the full selection.
   */
  related?: boolean;
  /**
   * With `related`, for the agent's own `run_tests` only, never a gate or verification: a
   * `test` script that ends by running a script that is just the runner
   * (`pnpm run build && pnpm run test:unit`) runs that runner's related tests alone.
   */
  agentCheck?: boolean;
  /** Run every test in the selected workspaces, including detected runner configurations. */
  fullSuite?: boolean;
  /**
   * `files` are test files a run named as failing: run exactly those with their runner, isolated
   * as the full run is, and nothing else: no `test` script, no fallback, no retry. A file no
   * runner can take alone is not run, and no run is no pass (UPT-111).
   */
  only?: boolean;
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
  via?: string,
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
    scope: `${bin} tests related to ${paths.length} changed file${paths.length === 1 ? '' : 's'} (${via ? `its \`test\` script ends with \`${via}\`, the runner; the steps before it did not run` : 'its `test` script is the runner'})`,
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
  const recursive = manifest(root)?.scripts?.test;
  // A recursive root script already runs the workspace suites; do not run each again.
  if (
    options.fullSuite &&
    workspaces.includes('.') &&
    recursive &&
    /^pnpm\s+(?:-r|--recursive)\s+(?:run\s+)?test\s*$/.test(recursive)
  )
    return [
      {
        workspace: '.',
        covers: workspaces,
        cwd: root,
        command: recursive.replace(/(-r|--recursive)\b/, '$1 --no-bail'),
        scope: 'the recursive `test` script of the repository',
      },
    ];
  const plans: TestPlan[] = [];
  const shared = new Map<
    string,
    { runner: 'vitest' | 'jest'; dir: string; config: string; covers: string[] }
  >();
  const rootScript: string[] = [];
  /** With `only`: the files a plan runs, absolute. */
  const taken = new Set<string>();
  const selected =
    options.related || options.only ? relatedWorkspaces(root, workspaces, files) : workspaces;
  for (const workspace of selected) {
    const script = manifest(join(root, workspace))?.scripts?.test;
    // The script a `test` chain ends by running: `… && pnpm run test:unit`.
    const last = /(?:^|&&)\s*(?:pnpm|npm|yarn)\s+(?:run\s+)?([\w:.-]+)\s*$/.exec(script ?? '')?.[1];
    const scoped =
      options.related && files.length
        ? (relatedScript(root, workspace, script, files) ??
          (options.agentCheck && last && last !== 'test'
            ? relatedScript(
                root,
                workspace,
                manifest(join(root, workspace))?.scripts?.[last],
                files,
                last,
              )
            : undefined))
        : undefined;
    if (scoped) {
      plans.push(scoped);
      continue;
    }
    // A script that is just the runner is planned as the runner: scoped, and classified.
    const bare = /^\s*(?:(?:npx|pnpm exec|yarn)\s+)?(vitest|jest)\b/.exec(script ?? '')?.[1];
    if (script && !options.only && !(bare && runnerFor(root, workspace)?.runner === bare)) {
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
    if (options.only) continue;
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
    const related = [...new Set(options.fullSuite ? [] : files)]
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
    if (options.only) {
      if (!targets.length) continue;
      for (const file of targets) taken.add(join(group.dir, file));
      // The first run already ran `pretest` on this tree; the files alone run again.
      plans.push({
        workspace,
        covers: group.covers,
        cwd: group.dir,
        command: [
          group.runner,
          ...(group.runner === 'vitest'
            ? ['run', ...isolate, ...targets]
            : ['--runTestsByPath', ...targets, ...isolate]
          ).map(quote),
        ].join(' '),
        scope: `${group.runner} on ${targets.length} test file${targets.length === 1 ? '' : 's'} that failed, run again alone`,
        ...(unitOnly && group.runner === 'vitest'
          ? {
              write: {
                path: join(group.dir, wrapper),
                text: unitConfig(group.config, needs.setups.length > 0),
              },
            }
          : {}),
      });
      continue;
    }
    const args =
      group.runner === 'vitest'
        ? targets.length
          ? ['related', '--run', '--passWithNoTests', ...isolate, ...targets]
          : ['run', '--passWithNoTests', ...isolate, ...dirs.filter((d) => d !== '.')]
        : // Paths before `--testPathIgnorePatterns`: jest reads that option as an array, and
          // every argument after it as one more pattern, files included.
          targets.length
          ? ['--findRelatedTests', ...targets, '--passWithNoTests', ...isolate]
          : ['--passWithNoTests', ...dirs.filter((d) => d !== '.'), ...isolate];
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
    const ownScript = scripts?.test ?? manifest(root)?.scripts?.test;
    const whole =
      group.runner === 'vitest'
        ? ['run', '--passWithNoTests', ...isolate, ...dirs.filter((d) => d !== '.')]
        : ['--passWithNoTests', ...dirs.filter((d) => d !== '.'), ...isolate];
    const fallback = !targets.length
      ? undefined
      : unitOnly
        ? {
            command: [group.runner, ...whole.map(quote)].join(' '),
            scope: `${group.runner} unit tests under ${dirs.join(', ')}, ${where}`,
          }
        : ownScript
          ? {
              command: prepare ? `${prepare} && ${ownScript}` : ownScript,
              scope: `the \`test\` script of the repository${prepare ? ' after `pretest`' : ''}`,
            }
          : undefined;
    plans.push({
      workspace,
      covers: group.covers,
      cwd: group.dir,
      command: prepare ? `${prepare} && ${run}` : run,
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
      ...(fallback ? { fallback } : {}),
      ...(sensitive && options.withServices
        ? { services: { names: needsText, targets: needs.targets } }
        : {}),
    });
  }
  const untaken = options.only ? files.filter((file) => !taken.has(join(root, file))) : [];
  if (untaken.length)
    plans.push({
      workspace: '.',
      covers: [],
      cwd: root,
      command: '',
      scope: `no runner runs ${untaken.join(', ')} alone`,
    });
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

/** The runner exited cleanly having run nothing ("No tests found"): no evidence either way. */
function noTestsRan(result: { code: number; timeout: boolean }, output: string): boolean {
  return (
    !result.code &&
    !result.timeout &&
    /No test files found|No tests found/i.test(output) &&
    !testSummary(output)
  );
}
/** Untracked, not ignored files, repository-relative. */
export function untrackedFiles(root: string): string[] {
  return git(root, 'ls-files', '-z', '--others', '--exclude-standard').split('\0').filter(Boolean);
}

/**
 * What the baseline tests left: a changed tracked file refuses the run; new untracked files
 * (a junit test-report.xml) are test artifacts. They go in the clone's info/exclude, so no
 * status, diff, `git add` or agent listing sees them, and are removed now; `clearing` removes
 * them again before each later test run.
 */
export function testArtifacts(root: string, before: string[]): string[] {
  const known = new Set(before);
  const created = untrackedFiles(root).filter((f) => !known.has(f));
  if (git(root, 'status', '--porcelain', '--untracked-files=no'))
    throw new Error('baseline tests modified the working tree; review their changes before fixing');
  excludeArtifacts(root, created);
  return created;
}

/** Hides recorded test artifacts from git in this clone and removes them. */
export function excludeArtifacts(root: string, files: string[]): void {
  if (!files.length) return;
  // ponytail: the private clone's info/exclude (fix and verify always run in one); restore it if either ever runs in place.
  const exclude = resolve(root, git(root, 'rev-parse', '--git-path', 'info/exclude'));
  // Patterns there are anchored at the repository top, not at a project in a subdirectory.
  const prefix = git(root, 'rev-parse', '--show-prefix');
  mkdirSync(dirname(exclude), { recursive: true });
  appendFileSync(
    exclude,
    files.map((f) => `/${`${prefix}${f}`.replace(/[\\*?[\]!# ]/g, '\\$&')}\n`).join(''),
  );
  clearArtifacts(root, files);
}

function clearArtifacts(root: string, files: string[]): void {
  for (const file of files) rmSync(join(root, file), { force: true });
}

/** The same services, with the test artifacts removed before each test run. */
export function clearing<S extends { tests: (...args: never[]) => unknown }>(
  services: S,
  root: string,
  artifacts: string[],
): S {
  if (!artifacts.length) return services;
  const tests = services.tests as (...args: unknown[]) => unknown;
  return {
    ...services,
    tests: (...args: unknown[]) => {
      clearArtifacts(root, artifacts);
      return tests(...args);
    },
  };
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
    const attempt = () =>
      command(plan.cwd, process.env.SHELL ?? '/bin/sh', ['-c', plan.command], timeoutMs, {
        PATH: [...bins, process.env.PATH].join(':'),
      });
    // Stored and published as text: no terminal colors, no path of this machine.
    const plain = (text: string): string =>
      text.replace(ANSI, '').split(realRoot).join('<repo>').split(root).join('<repo>');
    if (plan.write) writeFileSync(plan.write.path, plan.write.text);
    let result: Awaited<ReturnType<typeof attempt>>;
    let retried: string[] = [];
    let fellBack: TestResult['fallback'];
    try {
      result = await attempt();
      if (
        result.code &&
        !result.timeout &&
        !options.related &&
        !options.fullSuite &&
        !options.only
      ) {
        // A failure in a test that is not about the affected files gets one more run: a socket
        // reset in an unrelated e2e test must not fail a migration. A test of an affected file
        // that fails is ours, and is never retried into a pass.
        const failing = failedTestFiles(plain(result.output));
        if (failing.length > 0 && failing.every((file) => !concerns(file, files))) {
          const again = await attempt();
          if (!again.code && !again.timeout) retried = failing;
          result = again;
        }
      }
      // The related-tests run failed without a failing test (the runner refused its
      // arguments, say), or found no test related to the affected files: the repository's
      // own suite (plan.fallback) runs, and its verdict counts. A failing test is never run
      // again under a wider command that might skip it.
      const scopedOutput = plain(result.output);
      const refused =
        !!result.code &&
        !result.timeout &&
        failedTestFiles(scopedOutput).length === 0 &&
        !/^\s*Tests?:?\s.*\b\d+ failed/m.test(scopedOutput);
      if (!options.related && plan.fallback && (refused || noTestsRan(result, scopedOutput))) {
        const scoped = result;
        result = await command(
          plan.cwd,
          process.env.SHELL ?? '/bin/sh',
          ['-c', plan.fallback.command],
          timeoutMs,
          { PATH: [...bins, process.env.PATH].join(':') },
        );
        fellBack = {
          command: plan.command,
          reason: refused ? 'failed' : 'no-related',
          output: plain(scoped.output).split('\n').slice(-40).join('\n').trim(),
          ranInstead: plan.fallback.command,
        };
      }
    } finally {
      // The unit-only configuration exists for the run alone.
      if (plan.write) rmSync(plan.write.path, { force: true });
    }
    const output = plain(result.output);
    const summary = testSummary(output);
    // The runner passed with nothing to run: that is "no tests", not a green suite.
    const empty = noTestsRan(result, output);
    results.push({
      workspace: plan.workspace,
      status: result.timeout ? 'timeout' : result.code ? 'failed' : empty ? 'missing' : 'passed',
      output: empty ? `no tests are related to the affected files (${plan.command})` : output,
      command: fellBack ? fellBack.ranInstead : plan.command,
      ...described,
      ...(fellBack ? { scope: plan.fallback?.scope ?? plan.scope, fallback: fellBack } : {}),
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
 * counted against verification; a new failing file is still a failure. With `anyCommand`, a
 * run of another scope (related tests against the parent's full suite) is compared by the test
 * files it names only: a run that names none never matches.
 */
export function markPreexisting(
  tests: TestResult[],
  baseline: TestResult[],
  options: { anyCommand?: boolean } = {},
): TestResult[] {
  return tests.map((t) => {
    if (t.status !== 'failed' && t.status !== 'timeout') return t;
    const before = baseline.find(
      (b) =>
        b.workspace === t.workspace &&
        (options.anyCommand || b.command === t.command) &&
        (b.status === 'failed' || b.status === 'timeout'),
    );
    if (!before) return t;
    const now = failedTestFiles(t.output);
    const then = new Set(failedTestFiles(before.output));
    if (now.length === 0 && then.size === 0 && !options.anyCommand)
      return { ...t, preexisting: ['*'] };
    if (now.length > 0 && now.every((f) => then.has(f))) return { ...t, preexisting: now };
    return t;
  });
}
