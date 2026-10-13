import { spawn } from 'node:child_process';

/** Set in the child: run the one pack in this process, as before isolation existed. */
export const IN_PROCESS_ENV = 'UPTIDE_PACK_TEST_IN_PROCESS';

/** One pack's test, past which it is abandoned: the slowest pack takes minutes, not this. */
export const PACK_TIMEOUT_MS = 20 * 60_000;

export interface IsolatedRun {
  /** What the child printed on stdout (`--json`): the pack's report. */
  stdout: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  /** The last lines of its log, to say where it was when it stopped. */
  lastLines: string[];
}

/**
 * Runs `argv` (a node command line) in its own process group, its stderr passed through line by
 * line. At the deadline the whole group is killed: a check stuck in a compile, a garbage
 * collector that never finishes, or an install's grandchild that holds a pipe open all end with
 * it. The parent stays responsive whatever the child does, so the deadline always fires.
 */
export function runIsolated(options: {
  argv: string[];
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  onLine?: (line: string) => void;
}): Promise<IsolatedRun> {
  return new Promise((resolve) => {
    const [bin, ...args] = options.argv as [string, ...string[]];
    const child = spawn(bin, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    const lastLines: string[] = [];
    let partial = '';
    let timedOut = false;
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      const lines = (partial + chunk.toString('utf8')).split('\n');
      partial = lines.pop() ?? '';
      for (const line of lines) {
        options.onLine?.(line);
        lastLines.push(line);
        if (lastLines.length > 5) lastLines.shift();
      }
    });
    const kill = () => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        // already gone
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, options.timeoutMs);
    // Interrupted (Ctrl-C, a cancelled job): the child's group goes first, then this process
    // takes the signal as it would have without a listener.
    const onSignal = (signal: NodeJS.Signals) => {
      kill();
      unlisten();
      process.kill(process.pid, signal);
    };
    const unlisten = () => {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    const done = (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timer);
      unlisten();
      if (partial) {
        options.onLine?.(partial);
        lastLines.push(partial);
      }
      resolve({
        stdout: Buffer.concat(out).toString('utf8'),
        code,
        signal,
        timedOut,
        lastLines: lastLines.slice(-5),
      });
    };
    child.once('error', () => done(1, null));
    child.once('close', done);
  });
}

/** Why an isolated pack test produced no report, in one sentence. */
export function unfinishedReason(run: IsolatedRun, timeoutMs: number): string {
  const where = run.lastLines.filter((l) => l.trim()).at(-1);
  const last = where ? `; last: ${where.trim().slice(0, 200)}` : '';
  const after =
    timeoutMs >= 60_000 && timeoutMs % 60_000 === 0
      ? `${timeoutMs / 60_000} min`
      : `${Math.round(timeoutMs / 1000)}s`;
  if (run.timedOut) return `timed out after ${after} and was stopped${last}`;
  return `the test process ended without a report (${run.signal ? `signal ${run.signal}` : `exit ${run.code}`})${last}`;
}
