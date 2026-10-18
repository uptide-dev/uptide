import {
  type Change,
  type CheckResult,
  cleanRuns,
  createNpmFetcher,
  diffPackage,
  type ErrorCode,
  type FixReport,
  fixPreflight,
  InstallBlockedError,
  type ListOptions,
  type ListReport,
  listDependencies,
  openPr,
  type PeerBlockerGroup,
  PeerPreflightError,
  type PreflightOptions,
  type PrOptions,
  type ProgressEvent,
  type ProgressListener,
  type PublishTarget,
  publishTarget,
  ReportedError,
  removeOnInterrupt,
  removeRun,
  typescriptAdapter,
  UptideError,
  updatePrBody,
  workerHeapMb,
} from '@uptide/core';
import {
  type CheckRequest,
  type FixRequest,
  type Job,
  type PlanResult,
  runJob,
  type VerifyRequest,
} from './jobs.js';

/** Kept injectable for CLI tests; provided by the engine's public export. */
export type UpdatePrBody = (opts: {
  pr: string;
  cwd: string;
  run?: string;
  preview?: boolean;
}) => Promise<{ body: string; updated: boolean; url: string }>;

/** The engine as the CLI uses it. Tests substitute an in-memory one. */
export interface Engine {
  list?(request: ListOptions): Promise<ListReport>;
  check(request: CheckRequest, onProgress?: ProgressListener): Promise<CheckResult>;
  /** Discovery plus optional saved check evidence, with peer constraints and effort. */
  plan?(request: CheckRequest, onProgress?: ProgressListener): Promise<PlanResult>;
  fix(request: FixRequest, onProgress?: ProgressListener): Promise<FixReport>;
  /** Remove kept temporary clones older than `days`; lists what was removed and what remains. */
  clean?(days: number): { removed: string[]; kept: string[] };
  /** Verify the checked-out migration branch again and refresh its stored run. */
  verify?(request: VerifyRequest, onProgress?: ProgressListener): Promise<FixReport>;
  /** What fix settles about the checkout before any work: throws when a `--pr` run must not start. */
  preflight?(cwd: string, options: PreflightOptions): { head: string; notes: string[] };
  /** Where a `--pr` run will open its PR, resolved before any work: needs `gh` signed in. */
  publishTarget?(cwd: string, repo?: string): Promise<PublishTarget>;
  /** Push a finished run's branch and open its PR with the stored body. */
  pr?(
    request: PrOptions,
    print: (text: string) => void,
  ): Promise<{ url: string; report: FixReport }>;
  diff(name: string, from: string, to: string): Promise<Change[]>;
  /** The registry's `latest` for a package. */
  latest(name: string): Promise<string>;
  workspaces(root: string): Promise<string[]>;
  /** Direct dependencies of one package directory at their locked versions. */
  installed(dir: string): Promise<Map<string, string>>;
  /** Direct dependencies as written in package.json (`^3.23.8`, `catalog:`). */
  declared(dir: string): Promise<Map<string, string>>;
  updatePrBody?: UpdatePrBody;
}

/** Built: a worker thread next to this file. From source (tests, tsx) the job runs in place. */
async function offThread<T>(job: Job, onProgress?: ProgressListener): Promise<T> {
  const here = import.meta.url;
  if (here.endsWith('.ts')) return (await runJob(job, onProgress)) as T;
  // The job thread holds the programs of a single-package repository itself.
  return inWorker<T>(new URL('./engine-worker.js', here), job, onProgress, workerHeapMb(1));
}

/**
 * Runs `url` as the job thread. However it ends (a reply, a crash, out of memory, an interrupt
 * of this process) the clones it reported as in use are removed: a thread that dies cannot
 * clean up after itself (UPT-82).
 */
export function inWorker<T>(
  url: URL,
  workerData: unknown,
  onProgress: ProgressListener | undefined,
  heapMb: number,
): Promise<T> {
  return import('node:worker_threads').then(
    ({ Worker }) =>
      new Promise<T>((resolvePromise, reject) => {
        const worker = new Worker(url, {
          workerData,
          resourceLimits: { maxOldGenerationSizeMb: heapMb },
        });
        let settled = false;
        let failure: unknown;
        // The clones the job is working in: an interrupt removes them (`removeOnInterrupt`).
        const clones = new Set<string>();
        let release: (() => void) | undefined;
        const done = () => {
          release?.();
          release = undefined;
        };
        worker.on(
          'message',
          (
            reply:
              | { type: 'progress'; event: ProgressEvent }
              | { type: 'clone'; clone: string; interruptible: boolean }
              | { ok: true; value: T }
              | {
                  ok: false;
                  message: string;
                  code: ErrorCode;
                  peerConflicts?: PeerBlockerGroup[];
                  next?: string;
                  blocked?: InstallBlockedError['blocked'];
                  report?: object;
                },
          ) => {
            if ('type' in reply) {
              if (reply.type === 'progress') onProgress?.(reply.event);
              else {
                if (reply.interruptible) clones.add(reply.clone);
                else clones.delete(reply.clone);
                if (clones.size) release ??= removeOnInterrupt(() => clones);
                else done();
              }
              return;
            }
            settled = true;
            done();
            if (reply.ok) resolvePromise(reply.value);
            else
              reject(
                reply.peerConflicts && reply.next
                  ? new PeerPreflightError(reply.peerConflicts, reply.next, reply.message)
                  : reply.blocked
                    ? new InstallBlockedError(reply.blocked)
                    : reply.report
                      ? new ReportedError(reply.code, reply.message, reply.report)
                      : new UptideError(reply.code, reply.message),
              );
          },
        );
        worker.once('error', (err) => {
          failure = err;
        });
        worker.once('exit', (code) => {
          done();
          if (settled) return;
          for (const clone of clones) removeRun(clone);
          const oom =
            (failure as { code?: string } | undefined)?.code === 'ERR_WORKER_OUT_OF_MEMORY';
          reject(
            oom
              ? new UptideError(
                  'ERR_WORKER_OUT_OF_MEMORY',
                  `Repository too large for analysis: the analysis ran out of its ${heapMb} MB of memory. Your checkout was not changed and the temporary clone was removed. Close other applications and retry.`,
                )
              : (failure ?? new Error(`analysis stopped unexpectedly (worker exit code ${code})`)),
          );
        });
      }),
  );
}

export function defaultEngine(): Engine {
  return {
    list: listDependencies,
    check: (request, onProgress) => offThread<CheckResult>({ kind: 'check', request }, onProgress),
    plan: (request, onProgress) => offThread<PlanResult>({ kind: 'plan', request }, onProgress),
    fix: (request, onProgress) => offThread<FixReport>({ kind: 'fix', request }, onProgress),
    verify: (request, onProgress) => offThread<FixReport>({ kind: 'verify', request }, onProgress),
    clean: (days) => cleanRuns({ days }),
    pr: (request, print) => openPr(request, print),
    preflight: fixPreflight,
    publishTarget: (cwd, repo) => publishTarget(cwd, repo),
    diff: (name, from, to) => diffPackage({ name, from, to }),
    latest: (name) => createNpmFetcher().resolve(name, 'latest'),
    workspaces: async (root) =>
      (await typescriptAdapter.workspacePackages?.({ dir: root })) ?? ['.'],
    installed: async (dir) =>
      (await typescriptAdapter.installedDependencies?.({ dir })) ?? new Map<string, string>(),
    declared: async (dir) =>
      (await typescriptAdapter.declaredSpecifiers?.({ dir })) ?? new Map<string, string>(),
    updatePrBody,
  };
}
