import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import type { ts } from 'ts-morph';
import type { RepoDir } from '../../domain/adapter.js';
import { onReset } from '../../shared-state.js';
import { repositoryCompiler } from './compiler.js';
import { inheritedTsconfigOf } from './repo.js';

export interface CompileProject {
  config: string;
  /** The compiler's file closure, including imports of excluded files (exclude only filters roots). */
  files: Set<string>;
  invalid: boolean;
}

export interface ProjectScope {
  projects: CompileProject[];
  covers(file: string): boolean;
}

const scopes = new Map<string, ProjectScope>();
onReset(() => scopes.clear());

export function forgetProjectScope(): void {
  scopes.clear();
}

/** All independent projects plus their recursive references; extended option files aren't projects. */
export function projectScope(repo: RepoDir): ProjectScope {
  const root = realpathSync(repo.root ?? repo.dir);
  const inherited = inheritedTsconfigOf(realpathSync(repo.dir));
  const key = JSON.stringify([root, inherited]);
  const known = scopes.get(key);
  if (known) return known;
  const tsc = repositoryCompiler(root).ts;
  const paths = new Set(
    tsc.sys.readDirectory(
      root,
      ['.json'],
      [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/build/**',
        '**/coverage/**',
        '**/.next/**',
        '**/.turbo/**',
      ],
      ['**/tsconfig.json', '**/tsconfig.*.json'],
    ),
  );
  // A workspace without its own config can be included by the root's project. Its include
  // and exclude still apply; inheriting just the compiler options would invent build roots.
  if (
    !existsSync(join(root, 'tsconfig.json')) &&
    inherited &&
    (!repo.root || !relative(root, inherited).startsWith('..'))
  )
    paths.add(inherited);
  const referenced = new Set<string>();
  const parsed = new Map<string, { command: ts.ParsedCommandLine; extended: string[] }>();
  for (const path of paths) {
    const compiler = repositoryCompiler(dirname(path)).ts;
    const command = compiler.getParsedCommandLineOfConfigFile(
      path,
      {},
      {
        ...compiler.sys,
        onUnRecoverableConfigFileDiagnostic: () => {},
      },
    );
    if (!command) continue;
    const configFile = command.options.configFile as
      | (ts.SourceFile & { extendedSourceFiles?: string[] })
      | undefined;
    parsed.set(path, { command, extended: configFile?.extendedSourceFiles ?? [] });
    for (const ref of command.projectReferences ?? []) {
      const config = compiler.resolveProjectReferencePath(ref);
      if (existsSync(config)) {
        paths.add(config);
        referenced.add(config);
      }
    }
  }
  const bases = new Set([...parsed.values()].flatMap((p) => p.extended));
  const projects: CompileProject[] = [];
  for (const config of paths) {
    const entry = parsed.get(config);
    if (bases.has(config) && basename(config) !== 'tsconfig.json' && !referenced.has(config))
      continue;
    const command = entry?.command;
    const invalid = !command || command.errors.some((e) => ![18002, 18003].includes(e.code));
    const files = new Set<string>();
    if (command && !invalid) {
      const compiler = repositoryCompiler(dirname(config)).ts;
      const program = compiler.createProgram({
        rootNames: command.fileNames,
        options: { ...command.options, noEmit: true, skipLibCheck: true },
        projectReferences: command.projectReferences,
      });
      for (const file of program.getSourceFiles()) {
        if (!file.fileName.includes('/node_modules/')) files.add(resolve(file.fileName));
      }
    }
    projects.push({ config, files, invalid });
  }
  const scope: ProjectScope = {
    projects,
    // An invalid project cannot establish that a file is outside it. Its compile is skipped
    // with the config error; don't claim an exclusion based on incomplete configuration.
    covers: (file) =>
      projects.some(
        (p) =>
          p.files.has(resolve(file)) ||
          (p.invalid && resolve(file).startsWith(`${dirname(p.config)}/`)),
      ),
  };
  scopes.set(key, scope);
  return scope;
}
