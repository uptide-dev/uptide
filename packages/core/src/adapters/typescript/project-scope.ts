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
  covers(file: string): boolean;
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
  const key = repo.root ? root : JSON.stringify([root, inherited]);
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
  const configurations = new Set<string>();
  // Scope needs only import edges, not ASTs, binding, library types or project-reference
  // programs. Share the small preprocessing result across overlapping configs.
  const imports = new Map<string, ts.PreProcessedFileInfo>();
  for (const config of paths) {
    const entry = parsed.get(config);
    if (bases.has(config) && basename(config) !== 'tsconfig.json' && !referenced.has(config))
      continue;
    const command = entry?.command;
    const invalid = !command || command.errors.some((e) => ![18002, 18003].includes(e.code));
    if (command && !invalid) {
      const { configFilePath: _path, configFile: _file, ...options } = command.options;
      const identity = JSON.stringify([
        repositoryCompiler(dirname(config)).version,
        Object.entries(options).sort(([a], [b]) => a.localeCompare(b)),
        command.fileNames.slice().sort(),
        command.projectReferences,
      ]);
      // A config that only extends another project without changing its roots/options is
      // the same compile (Excalidraw's examples/excalidraw/tsconfig.json, for example).
      if (configurations.has(identity)) continue;
      configurations.add(identity);
    }
    const files = new Set(command?.fileNames.map((f) => resolve(f)) ?? []);
    let expanded = false;
    const covers = (file: string): boolean => {
      file = resolve(file);
      if (invalid) return file.startsWith(`${dirname(config)}/`);
      if (files.has(file)) return true;
      if (expanded || !command || command.options.noResolve) return false;
      expanded = true;
      const compiler = repositoryCompiler(dirname(config)).ts;
      const host = compiler.sys;
      const cache = compiler.createModuleResolutionCache(
        dirname(config),
        (f) => f,
        command.options,
      );
      const add = (path: string | undefined) => {
        // Dependency declarations cannot promote arbitrary examples into build roots.
        // Workspace symlinks are resolved by the compiler before this test.
        if (
          path &&
          !path.includes('/node_modules/') &&
          (!/\.[cm]?jsx?$/.test(path) || (command.options.allowJs ?? command.options.checkJs)) &&
          host.fileExists(path)
        )
          files.add(resolve(path));
      };
      const addType = (name: string, containingFile: string) =>
        add(
          compiler.resolveTypeReferenceDirective(name, containingFile, command.options, host)
            .resolvedTypeReferenceDirective?.resolvedFileName,
        );
      for (const name of compiler.getAutomaticTypeDirectiveNames(command.options, host))
        addType(name, config);
      for (const path of files) {
        let info = imports.get(path);
        if (!info) {
          info = compiler.preProcessFile(host.readFile(path) ?? '', true, true);
          imports.set(path, info);
        }
        const mode = compiler.getImpliedNodeFormatForFile(path, undefined, host, command.options);
        for (const ref of info.importedFiles)
          add(
            compiler.resolveModuleName(
              ref.fileName,
              path,
              command.options,
              host,
              cache,
              undefined,
              mode,
            ).resolvedModule?.resolvedFileName,
          );
        for (const ref of info.referencedFiles) add(resolve(dirname(path), ref.fileName));
        for (const ref of info.typeReferenceDirectives) addType(ref.fileName, path);
      }
      return files.has(file);
    };
    projects.push({ config, files, invalid, covers });
  }
  const scope: ProjectScope = {
    projects,
    // An invalid project cannot establish that a file is outside it. Its compile is skipped
    // with the config error; don't claim an exclusion based on incomplete configuration.
    covers: (file) =>
      projects.some((p) => p.files.has(resolve(file))) || projects.some((p) => p.covers(file)),
  };
  scopes.set(key, scope);
  return scope;
}
