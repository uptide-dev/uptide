import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { availableParallelism, freemem, platform, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { ts } from 'ts-morph';
import { readInstalled } from '../adapters/typescript/repo.js';
import { workspaceSourceMap } from '../adapters/typescript/workspace-source.js';
import { importersOf } from './importers.js';

const MB = 1024 ** 2;
/** Available physical memory, including reclaimable cache where the OS exposes it. */
export function freeMemoryBytes(): number {
  try {
    if (platform() === 'linux') {
      const available = /^MemAvailable:\s+(\d+) kB/m.exec(readFileSync('/proc/meminfo', 'utf8'));
      let bytes = available ? Number(available[1]) * 1024 : freemem();
      for (const [limitFile, usedFile] of [
        ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory.current'],
        [
          '/sys/fs/cgroup/memory/memory.limit_in_bytes',
          '/sys/fs/cgroup/memory/memory.usage_in_bytes',
        ],
      ]) {
        try {
          const limit = Number(readFileSync(limitFile as string, 'utf8').trim());
          const used = Number(readFileSync(usedFile as string, 'utf8').trim());
          if (Number.isFinite(limit) && Number.isFinite(used))
            bytes = Math.min(bytes, Math.max(0, limit - used));
        } catch {
          /* No cgroup limit on this host. */
        }
      }
      return bytes;
    }
    if (platform() === 'darwin') {
      const percent = /memory free percentage: (\d+)%/.exec(
        execFileSync('/usr/bin/memory_pressure', ['-Q'], { encoding: 'utf8', timeout: 1000 }),
      );
      if (percent) return (totalmem() * Number(percent[1])) / 100;
    }
  } catch {
    /* Fall back to the portable, more conservative free-page count. */
  }
  return freemem();
}

/** Reserve 40% of available memory for other work; allow native/young-generation overhead
 * inside each slot too. An override can lower the heap, never bypass the memory budget. */
export function memoryPolicy(
  freeBytes = freeMemoryBytes(),
  cpus = availableParallelism(),
  requested = cpus,
  estimateMb = 1024,
  env = process.env,
): { workers: number; heapMb: number; budgetMb: number } {
  const budgetMb = Math.floor((freeBytes / MB) * 0.6);
  const workers = Math.max(1, Math.min(cpus, requested, Math.floor(budgetMb / (estimateMb * 1.4))));
  const limit = Math.max(0, Math.floor(budgetMb / workers / 1.4));
  const override = Number(env.UPTIDE_WORKER_HEAP_MB);
  return {
    workers,
    heapMb: Math.min(
      8192,
      limit,
      Number.isFinite(override) && override >= 128 ? Math.floor(override) : 8192,
    ),
    budgetMb,
  };
}

interface ScopedGraph {
  /** The tsconfig's file list and options (with workspace source paths), when there is one. */
  fileNames: string[] | undefined;
  options: ts.CompilerOptions;
  /** Walk from `files`, skipping and extending `seen`: the bytes of what was new. */
  walk(
    files: Iterable<string>,
    seen: Set<string>,
  ): { sourceBytes: number; declarationBytes: number };
  /** The automatic type roots and default lib, which every program loads. */
  base: string[];
}

function scopedGraph(dir: string): ScopedGraph {
  const config = join(dir, 'tsconfig.json');
  const parsed = existsSync(config)
    ? ts.getParsedCommandLineOfConfigFile(
        config,
        {},
        { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
      )
    : undefined;
  const options: ts.CompilerOptions = parsed?.options ?? {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
  };
  const sources = workspaceSourceMap(dir, readInstalled(dir).installed);
  options.paths = { ...options.paths, ...sources.paths };
  const cache = ts.createModuleResolutionCache(dir, (p) => p, options);
  const typeOf = (name: string, containing: string): string | undefined =>
    ts.resolveTypeReferenceDirective(name, containing, options, ts.sys)
      .resolvedTypeReferenceDirective?.resolvedFileName;
  const base = [
    ...ts
      .getAutomaticTypeDirectiveNames(options, ts.sys)
      .map((name) => typeOf(name, join(dir, '__uptide__.ts'))),
    ts.getDefaultLibFilePath(options),
  ].filter((f): f is string => f !== undefined);
  const walk: ScopedGraph['walk'] = (files, seen) => {
    const pending = new Set<string>();
    const add = (file: string | undefined): void => {
      if (file !== undefined && !seen.has(file)) pending.add(file);
    };
    for (const file of files) add(file);
    let sourceBytes = 0;
    let declarationBytes = 0;
    for (const file of pending) {
      seen.add(file);
      const text = ts.sys.readFile(file);
      if (text === undefined) continue;
      if (/\.d\.[cm]?ts$/.test(file)) declarationBytes += Buffer.byteLength(text);
      else sourceBytes += Buffer.byteLength(text);
      const info = ts.preProcessFile(text, true, true);
      const mode = ts.getImpliedNodeFormatForFile(file, undefined, ts.sys, options);
      for (const imp of info.importedFiles)
        add(
          ts.resolveModuleName(imp.fileName, file, options, ts.sys, cache, undefined, mode)
            .resolvedModule?.resolvedFileName,
        );
      for (const ref of info.referencedFiles) add(resolve(dirname(file), ref.fileName));
      for (const ref of info.typeReferenceDirectives) add(typeOf(ref.fileName, file));
      for (const ref of info.libReferenceDirectives)
        add(
          join(
            dirname(ts.getDefaultLibFilePath(options)),
            `lib.${ref.fileName.toLowerCase()}.d.ts`,
          ),
        );
    }
    return { sourceBytes, declarationBytes };
  };
  return { fileNames: parsed?.fileNames, options, walk, base };
}

// Calibrated against isolated scoped checks (Outline mobx-react and Documenso zod).
// Checking application code expands more than loading declarations; each root also
// contributes checker/overlay state. The 1.4x RSS reservation in memoryPolicy is extra.
const heapOf = (sourceBytes: number, declarationBytes: number, roots: number): number =>
  Math.ceil(512 + (sourceBytes / MB) * 150 + (declarationBytes / MB) * 24 + roots * 4.5);

/** Estimate the reachable source/declaration graph without constructing a program or checker.
 * Include automatic ambient types and the same workspace source paths as the compiler.
 * Unrelated installed declarations and unrelated workspace sources contribute nothing. */
export function scopedMemoryEstimate(
  dir: string,
  roots?: string[],
): { heapMb: number; sourceBytes: number; declarationBytes: number; files: number } {
  const graph = scopedGraph(dir);
  const files = roots ?? graph.fileNames ?? [];
  const seen = new Set<string>();
  const { sourceBytes, declarationBytes } = graph.walk([...files, ...graph.base], seen);
  return {
    heapMb: heapOf(sourceBytes, declarationBytes, files.length),
    sourceBytes,
    declarationBytes,
    files: seen.size,
  };
}

/** How much a scoped program may grow to take in the importers of its roots. */
export const IMPORTER_GROWTH = 0.2;

/**
 * The files importing `roots` (one level, `importersOf`) whose imports from them depend on
 * `packages`, cheapest first, while the estimated heap stays within `growth` of the roots'
 * own. Each importer brings its own imports along, which the compiler follows: one that
 * pulls in a large SDK can cost more than the roots together.
 */
export function scopedImporters(
  dir: string,
  roots: string[],
  packages: readonly string[],
  growth = IMPORTER_GROWTH,
): string[] {
  const graph = scopedGraph(dir);
  if (!graph.fileNames || roots.length === 0) return [];
  const candidates = importersOf(graph.fileNames, roots, graph.options, packages);
  if (candidates.length === 0) return [];
  const seen = new Set<string>();
  const total = graph.walk([...roots, ...graph.base], seen);
  const budget = heapOf(total.sourceBytes, total.declarationBytes, roots.length) * (1 + growth);
  const cost = (file: string): number => {
    const added = graph.walk([file], new Set(seen));
    return added.sourceBytes * 150 + added.declarationBytes * 24;
  };
  // ponytail: greedy by cost against the roots alone; shared imports make later ones cheaper, which it ignores.
  const ranked = candidates
    .map((file) => ({ file, cost: cost(file) }))
    .sort((a, b) => a.cost - b.cost || a.file.localeCompare(b.file));
  const taken: string[] = [];
  for (const { file } of ranked) {
    const trial = new Set(seen);
    const added = graph.walk([file], trial);
    const heap = heapOf(
      total.sourceBytes + added.sourceBytes,
      total.declarationBytes + added.declarationBytes,
      roots.length + taken.length + 1,
    );
    if (heap > budget) continue;
    for (const f of trial) seen.add(f);
    total.sourceBytes += added.sourceBytes;
    total.declarationBytes += added.declarationBytes;
    taken.push(file);
  }
  return taken.sort();
}

export function estimateScopedHeapMb(dir: string, roots?: string[]): number {
  return scopedMemoryEstimate(dir, roots).heapMb;
}
