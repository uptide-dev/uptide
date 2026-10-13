import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runIsolated, unfinishedReason } from './pack-isolate.js';

const node = (source: string) => [process.execPath, '-e', source];
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('a pack test in its own process', () => {
  it('returns what the child printed, its log passed through line by line', async () => {
    const lines: string[] = [];
    const run = await runIsolated({
      argv: node(
        "process.stderr.write('fetching x\\nchecking x'); process.stdout.write(JSON.stringify({ packs: [1] }));",
      ),
      timeoutMs: 30_000,
      onLine: (l) => lines.push(l),
    });
    expect(run).toMatchObject({ code: 0, timedOut: false, stdout: '{"packs":[1]}' });
    expect(lines).toEqual(['fetching x', 'checking x']);
  });

  it('stops a child that never ends, and the processes it started, at the deadline', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'uptide-isolate-'));
    const pidFile = join(dir, 'grandchild');
    // A busy loop that never yields (a compile, a collector thrashing) and a grandchild that
    // would outlive its parent and keep the pipe open.
    const source = `
      const { spawn } = require('node:child_process');
      const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });
      require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(g.pid));
      process.stderr.write('checking ai 6 → 7 in vercel/chatbot\\n');
      setTimeout(() => { for (;;) {} }, 100);
    `;
    const started = Date.now();
    const run = await runIsolated({ argv: node(source), timeoutMs: 1500 });
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(run.timedOut).toBe(true);
    expect(run.signal).toBe('SIGKILL');
    expect(existsSync(pidFile)).toBe(true);
    const grandchild = Number(readFileSync(pidFile, 'utf8'));
    for (let i = 0; i < 50 && alive(grandchild); i++) await new Promise((r) => setTimeout(r, 100));
    expect(alive(grandchild)).toBe(false);
    expect(unfinishedReason(run, 20 * 60_000)).toBe(
      'timed out after 20 min and was stopped; last: checking ai 6 → 7 in vercel/chatbot',
    );
  });

  it('says how a child that died without a report ended', async () => {
    const run = await runIsolated({
      argv: node("process.stderr.write('installing x\\n'); process.exit(3)"),
      timeoutMs: 30_000,
    });
    expect(unfinishedReason(run, 60_000)).toBe(
      'the test process ended without a report (exit 3); last: installing x',
    );
  });
});
