import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inWorker } from './engine.js';

// A job thread reports the clone it works in, then dies in one of the ways a real one can.
// Whatever the way, the clone must be gone afterwards (UPT-82).
let scratch: string;
let previous: string | undefined;
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'uptide-engine-exit-'));
  previous = process.env.UPTIDE_RUNS_DIR;
  process.env.UPTIDE_RUNS_DIR = join(scratch, 'runs');
});
afterEach(() => {
  if (previous === undefined) delete process.env.UPTIDE_RUNS_DIR;
  else process.env.UPTIDE_RUNS_DIR = previous;
  rmSync(scratch, { recursive: true, force: true });
});

/** A run directory as `isolate` makes it: inside the runs root, named `run-*`, with its marker. */
function clone(): string {
  const run = join(scratch, 'runs', `run-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(run, 'repo'), { recursive: true });
  writeFileSync(join(run, '.uptide-run'), '{}');
  return join(run, 'repo');
}

function worker(then: string): URL {
  const file = join(scratch, `worker-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(
    file,
    `import { parentPort, workerData } from 'node:worker_threads';
parentPort.postMessage({ type: 'clone', clone: workerData.clone, interruptible: true });
parentPort.postMessage({ type: 'progress', event: { phase: 'ready' } });
setTimeout(() => { ${then} }, 50);
`,
  );
  return pathToFileURL(file);
}

describe('the job thread leaves no clone behind', () => {
  it('when it crashes', async () => {
    const repo = clone();
    await expect(
      inWorker(worker("throw new Error('boom')"), { clone: repo }, undefined, 64),
    ).rejects.toThrow('boom');
    expect(existsSync(join(repo, '..'))).toBe(false);
  });

  it('when it runs out of memory, and says the repository is too large', async () => {
    const repo = clone();
    await expect(
      inWorker(
        worker('const held = []; for (;;) held.push(new Array(1e5).fill(held.length));'),
        { clone: repo },
        undefined,
        32,
      ),
    ).rejects.toThrow(/^Repository too large for analysis: .* 32 MB/);
    expect(existsSync(join(repo, '..'))).toBe(false);
  }, 30000);

  it('when this process is interrupted (SIGINT)', async () => {
    const repo = clone();
    const engine = fileURLToPath(new URL('./engine.ts', import.meta.url));
    // From a file: a worker inherits the parent's flags, and `--input-type` (for `-e`) breaks it.
    const script = join(scratch, 'interrupted.mjs');
    writeFileSync(
      script,
      `import { inWorker } from ${JSON.stringify(engine)};
inWorker(new URL(${JSON.stringify(worker('setInterval(() => {}, 1000)').href)}), { clone: ${JSON.stringify(repo)} }, () => console.log('ready'), 64).catch(() => {});`,
    );
    const child = spawn(process.execPath, ['--import', 'tsx', script], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    child.stdout.on('data', (d: Buffer) => {
      if (d.toString().includes('ready')) child.kill('SIGINT');
    });
    const signal = await new Promise((resolve) => child.once('exit', (_code, s) => resolve(s)));
    expect(signal).toBe('SIGINT');
    expect(existsSync(join(repo, '..'))).toBe(false);
  }, 30000);
});
