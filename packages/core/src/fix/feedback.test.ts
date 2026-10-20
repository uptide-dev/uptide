import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';
import { zodPack } from '../packs/zod/index.js';
import { git } from './process.js';
import { formatFix, prBody } from './report.js';
import { fix } from './run.js';
import type { TaskRunner } from './sdk-agent.js';
import { zodFixture } from './test-fixture.js';

const scratch = mkdtempSync(join(tmpdir(), 'uptide-feedback-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const runResult = {
  turns: 1,
  inputTokens: 10,
  outputTokens: 10,
  costUsd: 0.1,
  durationMs: 1,
  toolCalls: {},
};
async function fixture() {
  const { root, services } = zodFixture(scratch);
  const report = await services.check({ cwd: root });
  for (const p of report.packages) p.findings = [];
  writeFileSync(
    join(root, 'index.ts'),
    "import { z } from 'zod';\nexport const schema = z.string().uuid();\n",
  );
  const types = 'export declare const z: { string(): { uuid(): boolean; guid(): boolean } };';
  writeFileSync(join(root, 'node_modules/zod/index.d.ts'), types);
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  manifest.scripts = { test: 'node uuid.test.cjs' };
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest));
  // Stand-in for zod 4's stricter UUID validator: the legacy GUID is not RFC 9562.
  writeFileSync(
    join(root, 'uuid.test.cjs'),
    `const assert = require('node:assert/strict');
const fs = require('node:fs');
const target = JSON.parse(fs.readFileSync('node_modules/zod/package.json')).version.startsWith('4.');
const source = fs.readFileSync('index.ts', 'utf8');
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const schema = pattern => ({ safeParse: value => ({ success: pattern.test(value) }) });
const context = { z: { string: () => ({ uuid: () => schema(target ? uuid : guid), guid: () => schema(guid) }) } };
require('node:vm').runInNewContext(source.split('\\n').slice(1).join('\\n').replace('export const schema =', 'globalThis.schema ='), context);
assert.ok(context.schema.safeParse('00000000-0000-0000-0000-000000000001').success, 'accepts legacy GUID: Invalid UUID');\n`,
  );
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'uuid behavioral fixture');
  const install = services.install;
  services.install = async (...args) => {
    await install(...args);
    writeFileSync(join(root, 'node_modules/zod/index.d.ts'), types);
  };
  services.format = async () => [];
  services.lint = async () => [];
  return { root, services, report };
}
const options = (root: string) => ({
  cwd: root,
  only: 'zod',
  agent: 'sdk' as const,
  provider: 'anthropic',
  maxCostUsd: 0.25,
});

it('feeds a test-only UUID regression to the agent and verifies the guid repair', async () => {
  const { root, services } = await fixture();
  const runner = vi.fn<TaskRunner>(async ({ prompt }) => {
    expect(prompt).toContain('accepts legacy GUID: Invalid UUID');
    expect(prompt).toContain('Never weaken or skip tests');
    writeFileSync(
      join(root, 'index.ts'),
      readFileSync(join(root, 'index.ts'), 'utf8').replace('.uuid()', '.guid()'),
    );
    return runResult;
  });
  const result = await fix(options(root), { ...services, agentRunner: runner });
  expect(runner).toHaveBeenCalledTimes(1);
  expect(result.verification.baselineTests[0]?.status).toBe('passed');
  expect(result.verification.tests[0]?.status).toBe('passed');
  expect(result.verification.passed).toBe(true);
  expect(prBody(result)).toContain('After verification feedback');
  expect(prBody(result)).toContain('index.ts');
  expect(prBody(result)).not.toContain('No code changes were needed');
});

it('starts no session the remaining budget is below a typical session for (UPT-111)', async () => {
  const { root, services } = await fixture();
  const runner = vi.fn<TaskRunner>(async () => runResult);
  const result = await fix(options(root), { ...services, agentRunner: runner });
  // $0.10 a session against $0.25: a third would start with $0.05 and cross the limit.
  expect(runner.mock.calls.map(([input]) => input.maxBudgetUsd)).toEqual([0.25, 0.15]);
  expect(result.llm.costUsd).toBeLessThanOrEqual(0.25);
  expect(result.llm.feedback?.stopped).toEqual({ remainingUsd: 0.05, typicalUsd: 0.1 });
  expect(result.verification.passed).toBe(false);
  expect(prBody(result)).toContain('Invalid UUID');
  expect(prBody(result)).toContain(
    "No further round: $0.05 left, below a session's typical $0.10.",
  );
});

it('counts the higher of computed and SDK-reported cost against --max-cost (UPT-127)', async () => {
  for (const [costUsd, sdkReportedCostUsd] of [
    [0.05, 0.1],
    [0.1, 0.05],
  ] as const) {
    const { root, services } = await fixture();
    const runner = vi.fn<TaskRunner>(async () => ({ ...runResult, costUsd, sdkReportedCostUsd }));
    const result = await fix(options(root), { ...services, agentRunner: runner });
    // Either way $0.10 a session counts: the second gets $0.15, and no third starts.
    expect(runner.mock.calls.map(([input]) => input.maxBudgetUsd)).toEqual([0.25, 0.15]);
    expect(result.llm.feedback?.stopped).toEqual({ remainingUsd: 0.05, typicalUsd: 0.1 });
    expect(result.llm.costUsd).toBeCloseTo(2 * costUsd, 9);
    expect(result.llm.sdkReportedCostUsd).toBeCloseTo(2 * sdkReportedCostUsd, 9);
  }
});

it('does not send failures already present at the parent to the agent', async () => {
  const { root, services } = await fixture();
  services.tests = async () => [{ workspace: '.', status: 'failed', output: 'old failure' }];
  const runner = vi.fn<TaskRunner>(async () => runResult);
  await fix(options(root), { ...services, agentRunner: runner });
  expect(runner).not.toHaveBeenCalled();
});

it('degrades an incomplete check to an agent-led lead upgrade', async () => {
  const { root, services, report } = await fixture();
  for (const p of report.packages) {
    p.status = 'unknown';
    p.notes = ['unknown baseline'];
  }
  services.build = async () => [{ workspace: '.', status: 'missing', output: 'build cannot run' }];
  const runner = vi.fn<TaskRunner>(async () => runResult);
  const result = await fix(options(root), { ...services, agentRunner: runner });
  expect(runner).toHaveBeenCalled();
  expect(result.target).toBe('4.6.5');
  expect(prBody(result)).toContain('unknown baseline');
  expect(result.verification.passed).toBe(false);
});

it('rejects attempts to skip tests or introduce any during feedback', async () => {
  for (const file of ['uuid.test.cjs', 'index.ts']) {
    const { root, services } = await fixture();
    const original = readFileSync(join(root, file), 'utf8');
    const runner: TaskRunner = async () => {
      writeFileSync(
        join(root, file),
        file.endsWith('.cjs') ? '' : 'export const schema: any = {};',
      );
      return runResult;
    };
    const result = await fix(options(root), { ...services, agentRunner: runner });
    expect(readFileSync(join(root, file), 'utf8')).toBe(original);
    expect(result.verification.passed).toBe(false);
    expect(result.llm.tasks?.[0]?.gate).toBe('rejected');
    expect(prBody(result)).toContain('rejected');
  }
});

it('degrades an unavailable required build to an agent-led upgrade', async () => {
  const { root, services } = await fixture();
  services.build = async () => [{ workspace: '.', status: 'missing', output: 'no build script' }];
  const runner = vi.fn<TaskRunner>(async () => runResult);
  const result = await fix(
    { ...options(root), pack: { ...zodPack, requiresBuild: true } },
    { ...services, agentRunner: runner },
  );
  expect(runner.mock.calls[0]?.[0].prompt).toContain('build');
  expect(prBody(result)).toContain('Agent-led fallback');
});

it('continues after the check planner throws, without a registry or LLM call', async () => {
  const { root, services } = await fixture();
  services.check = async () => {
    throw new Error('planner refusal fixture');
  };
  services.build = async () => [];
  const runner = vi.fn<TaskRunner>(async () => runResult);
  const result = await fix(options(root), { ...services, agentRunner: runner });
  expect(runner).toHaveBeenCalled();
  expect(prBody(result)).toContain('planner refusal fixture');
});

it('repairs test feedback with a mocked patch provider', async () => {
  const { root, services } = await fixture();
  const patch = vi.fn(async () => ({
    diff: '--- a/index.ts\n+++ b/index.ts\n@@ -2 +2 @@\n-export const schema = z.string().uuid();\n+export const schema = z.string().guid();\n',
    inputTokens: 10,
    outputTokens: 10,
    costUsd: 0.01,
  }));
  const result = await fix(
    { cwd: root, only: 'zod', fixer: { id: 'mock', estimate: () => 0.02, fix: patch } },
    services,
  );
  expect(patch).toHaveBeenCalledTimes(1);
  expect(result.verification.passed).toBe(true);
});

it('feeds a build regression only when the same parent build passed', async () => {
  const { root, services } = await fixture();
  services.tests = async () => [{ workspace: '.', status: 'passed', output: '' }];
  services.build = async () => {
    const target = JSON.parse(
      readFileSync(join(root, 'node_modules/zod/package.json'), 'utf8'),
    ).version.startsWith('4.');
    const failed = target && readFileSync(join(root, 'index.ts'), 'utf8').includes('.uuid()');
    return [
      {
        workspace: '.',
        status: failed ? 'failed' : 'passed',
        command: 'build',
        output: failed ? 'build error: legacy GUID validator' : '',
      },
    ];
  };
  const runner = vi.fn<TaskRunner>(async ({ prompt }) => {
    expect(prompt).toContain('build error: legacy GUID validator');
    writeFileSync(
      join(root, 'index.ts'),
      readFileSync(join(root, 'index.ts'), 'utf8').replace('.uuid()', '.guid()'),
    );
    return runResult;
  });
  const result = await fix(
    { ...options(root), pack: { ...zodPack, requiresBuild: true } },
    { ...services, agentRunner: runner },
  );
  expect(runner).toHaveBeenCalledTimes(1);
  expect(result.verification.build?.[0]?.status).toBe('passed');
});

it('reserves patch costs across rounds, even when the provider throws', async () => {
  const { root, services } = await fixture();
  const patch = vi.fn(async () => {
    throw new Error('mock provider unavailable');
  });
  const result = await fix(
    {
      cwd: root,
      only: 'zod',
      maxCostUsd: 0.05,
      fixer: { id: 'mock', estimate: () => 0.03, fix: patch },
    },
    services,
  );
  expect(patch).toHaveBeenCalledTimes(1);
  expect(result.llm.unreportedCostUsd).toBe(0.03);
  expect(result.verification.passed).toBe(false);
});

it('stops feedback when a runner throws without reporting usage', async () => {
  const { root, services } = await fixture();
  const runner = vi.fn<TaskRunner>(async () => {
    throw new Error('mock SDK transport failed');
  });
  const result = await fix(options(root), { ...services, agentRunner: runner });
  expect(runner).toHaveBeenCalledTimes(1);
  expect(result.llm.unreportedCostUsd).toBe(0.25);
});

it('flags an explained update of an old expected value for review', async () => {
  const { root, services } = await fixture();
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  manifest.scripts.test = 'node message.test.cjs';
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest));
  const test = `const assert = require('node:assert/strict');
const version = require('./node_modules/zod/package.json').version;
const message = version.startsWith('4.') ? 'new message' : 'old message';
assert.equal(message, 'old message');\n`;
  writeFileSync(join(root, 'message.test.cjs'), test);
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'old expected message fixture');
  const reason = 'Zod 4 changes the default error message; keep asserting the exact new message.';
  const runner = vi.fn<TaskRunner>(async () => {
    writeFileSync(
      join(root, 'message.test.cjs'),
      test.replace("assert.equal(message, 'old message')", "assert.equal(message, 'new message')"),
    );
    return {
      ...runResult,
      summary: {
        changed: [{ file: 'message.test.cjs', what: reason }],
        newFiles: [],
        decisions: [],
        assumptions: [],
        couldNotDo: [],
      },
    };
  });
  const result = await fix(options(root), { ...services, agentRunner: runner });
  expect(result.verification.passed).toBe(true);
  expect(runner).toHaveBeenCalledTimes(1);
  expect(prBody(result)).toContain('Tests changed: review');
  expect(prBody(result)).toContain(reason);
});

it.each(['failed', 'timeout', 'missing'] as const)(
  'never iterates tests or builds with a %s parent command',
  async (status) => {
    const { root, services } = await fixture();
    const target = () =>
      JSON.parse(
        readFileSync(join(root, 'node_modules/zod/package.json'), 'utf8'),
      ).version.startsWith('4.');
    services.tests = async () => [
      {
        workspace: '.',
        command: 'test',
        status: target() ? 'failed' : status,
        output: 'pre-existing test failure',
      },
    ];
    services.build = async () => [
      {
        workspace: '.',
        command: 'build',
        status: target() ? 'failed' : status,
        output: 'pre-existing build failure',
      },
    ];
    services.diagnostics = () => [
      { file: 'index.ts', line: 1, column: 1, code: 2322, message: 'pre-existing type failure' },
    ];
    const runner = vi.fn<TaskRunner>(async () => runResult);
    const result = await fix(
      { ...options(root), pack: { ...zodPack, requiresBuild: true } },
      { ...services, agentRunner: runner },
    );
    expect(runner).not.toHaveBeenCalled();
    expect(prBody(result)).toContain('pre-existing test failure');
    expect(prBody(result)).toContain('pre-existing build failure');
    expect(prBody(result)).toContain('pre-existing type failure');
  },
);

it('reports rounds used/max and total spend/cap, including zero feedback rounds', async () => {
  for (const passes of [true, false]) {
    const { root, services } = await fixture();
    if (passes) services.tests = async () => [{ workspace: '.', status: 'passed', output: '' }];
    const runner = vi.fn<TaskRunner>(async () => runResult);
    const result = await fix(options(root), { ...services, agentRunner: runner });
    expect(prBody(result)).toContain(`Feedback rounds: ${passes ? 0 : 2}/3`);
    expect(formatFix(result)).toContain(`Feedback rounds: ${passes ? 0 : 2}/3`);
    expect(prBody(result)).toContain(`Spend: $${passes ? '0.00' : '0.20'} / $0.25 cap`);
  }
});

it('does not retry a build that already timed out at the parent', async () => {
  const { root, services } = await fixture();
  services.tests = async () => [{ workspace: '.', status: 'passed', output: '' }];
  services.build = async () => [
    { workspace: '.', status: 'timeout', command: 'build', output: 'pre-existing timeout' },
  ];
  const runner = vi.fn<TaskRunner>(async () => runResult);
  const result = await fix(
    { ...options(root), pack: { ...zodPack, requiresBuild: true } },
    { ...services, agentRunner: runner },
  );
  expect(runner).not.toHaveBeenCalled();
  expect(prBody(result)).toContain('pre-existing timeout');
});

it.each(['failed', 'timeout'] as const)(
  'sends only the new failure when a different parent suite is %s and types already fail',
  async (status) => {
    const { root, services } = await fixture();
    const tests = services.tests;
    services.tests = async (...args) => [
      ...(await tests(...args)),
      { workspace: 'legacy', command: 'test', status, output: 'legacy failure sentinel' },
    ];
    services.diagnostics = () => [
      { file: 'index.ts', line: 1, column: 1, code: 2322, message: 'old type sentinel' },
    ];
    const runner = vi.fn<TaskRunner>(async ({ prompt }) => {
      expect(prompt).toContain('Invalid UUID');
      expect(prompt).not.toContain('legacy failure sentinel');
      expect(prompt).not.toContain('old type sentinel');
      writeFileSync(
        join(root, 'index.ts'),
        readFileSync(join(root, 'index.ts'), 'utf8').replace('.uuid()', '.guid()'),
      );
      return runResult;
    });
    const result = await fix(options(root), { ...services, agentRunner: runner });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(prBody(result)).toContain('legacy failure sentinel');
    expect(prBody(result)).toContain('old type sentinel');
  },
);

it.each([
  ['passes in verification', false],
  ['fails verification again', true],
] as const)(
  'keeps a session whose new failure passes when run again alone, and names it: %s (UPT-111)',
  async (_, again) => {
    const { root, services } = await fixture();
    const tests = services.tests;
    const reruns: string[][] = [];
    let flakes = 0;
    services.tests = async (cwd, workspaces, timeout, files, o) => {
      if (o?.only) {
        reruns.push(files ?? []);
        return [{ workspace: '.', status: 'passed', output: '', command: 'vitest run' }];
      }
      const results = await tests(cwd, workspaces, timeout, files, o);
      const repaired = readFileSync(join(root, 'index.ts'), 'utf8').includes('.guid()');
      if (!repaired || (flakes++ > 0 && !again)) return results;
      return results.map((t) => ({
        ...t,
        status: 'failed' as const,
        output: `${t.output}\n FAIL  flaky.test.ts > admission > times out`,
      }));
    };
    const runner = vi.fn<TaskRunner>(async () => {
      writeFileSync(
        join(root, 'index.ts'),
        readFileSync(join(root, 'index.ts'), 'utf8').replace('.uuid()', '.guid()'),
      );
      return runResult;
    });
    const result = await fix(options(root), { ...services, agentRunner: runner });
    expect(result.llm.tasks?.[0]).toMatchObject({ gate: 'accepted', flaky: ['flaky.test.ts'] });
    expect(reruns[0]).toEqual(['flaky.test.ts']);
    expect(readFileSync(join(root, 'index.ts'), 'utf8')).toContain('.guid()');
    expect(prBody(result)).toContain('Flaky: `flaky.test.ts` failed in an agent session');
    // The final verification keeps its full gate: a flaky failure there is a failure.
    expect(result.verification.passed).toBe(!again);
    expect(prBody(result)).toContain(
      again
        ? "Verification's full run failed `flaky.test.ts` again: rerun before merging."
        : 'Verification ran it in its full run.',
    );
  },
);

it('refuses an out-of-scope dependency bump every round, says so in the next prompt, and stops at the round limit (UPT-126)', async () => {
  const { root, services } = await fixture();
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  manifest.dependencies = { ...manifest.dependencies, 'left-pad': '1.0.0' };
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest));
  git(root, 'commit', '-qam', 'an unrelated dependency');
  const prompts: string[] = [];
  const runner: TaskRunner = async ({ prompt }) => {
    prompts.push(prompt);
    const now = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    now.dependencies['left-pad'] = '2.0.0';
    writeFileSync(join(root, 'package.json'), JSON.stringify(now));
    return runResult;
  };
  const result = await fix(
    { ...options(root), maxCostUsd: 1 },
    { ...services, agentRunner: runner },
  );
  expect(prompts).toHaveLength(3);
  expect(prompts[0]).not.toContain('left-pad');
  for (const prompt of prompts.slice(1))
    expect(prompt).toContain(
      "out of the agent's scope: Uptide's install sets every existing version and range, the upgraded package's and its companions' included; only adding a new dependency is allowed, and a stated reason does not change that: package.json dependencies left-pad: 1.0.0 → 2.0.0",
    );
  expect(result.llm.tasks?.map((t) => t.gate)).toEqual(['rejected', 'rejected', 'rejected']);
  for (const task of result.llm.tasks ?? [])
    expect(task.outOfScopeDependencyEdits).toEqual([
      {
        file: 'package.json',
        field: 'dependencies',
        name: 'left-pad',
        before: '1.0.0',
        after: '2.0.0',
        reverted: true,
      },
    ]);
  // The engine's own bump of zod stays; the agent's bump of left-pad never lands.
  expect(
    JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).dependencies['left-pad'],
  ).toBe('1.0.0');
  expect(prBody(result)).toContain('left-pad: 1.0.0 → 2.0.0');
});

it('sends a dependency bump refused in the first agent pass back with the first round (UPT-126)', async () => {
  const { root, services, report } = await fixture();
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  manifest.dependencies = { ...manifest.dependencies, 'left-pad': '1.0.0' };
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest, null, 2));
  git(root, 'commit', '-qam', 'an unrelated dependency');
  // A site the pack leaves manual in package.json (the sentry pack's script lines): the
  // first pass may edit that file.
  const [pkg] = report.packages;
  pkg?.findings.push({
    change: { package: 'zod', from: '3.25.76', to: '4.6.5', path: 'scripts', kind: 'removed' },
    usage: { file: 'package.json', line: 2, column: 1, snippet: '"name": "consumer",' },
    severity: 'breaking',
    confidence: 'high',
    fixability: 'assisted',
    reason: 'a script the upgrade changes',
  } as never);
  const prompts: string[] = [];
  const runner: TaskRunner = async ({ prompt }) => {
    prompts.push(prompt);
    if (prompts.length === 1) {
      const now = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
      now.dependencies['left-pad'] = '2.0.0';
      writeFileSync(join(root, 'package.json'), JSON.stringify(now, null, 2));
    }
    return runResult;
  };
  const result = await fix(
    { ...options(root), maxCostUsd: 1 },
    { ...services, agentRunner: runner },
  );
  expect(result.llm.tasks?.[0]).toMatchObject({
    gate: 'rejected',
    outOfScopeDependencyEdits: [{ name: 'left-pad', before: '1.0.0', after: '2.0.0' }],
  });
  expect(prompts.length).toBeGreaterThan(1);
  expect(prompts[1]).toContain('package.json dependencies left-pad: 1.0.0 → 2.0.0');
});
