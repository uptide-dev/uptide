import { Command } from 'commander';
import { expect, it, vi } from 'vitest';
import './cli.js';
import { invocation, repeatFlags } from './invocation.js';

const detect = vi.hoisted(() => vi.fn(() => 'npx uptide'));
vi.mock('@uptide/core', async (original) => ({
  ...(await original<typeof import('@uptide/core')>()),
  uptideInvocation: detect,
}));

it('detects the invocation on first use, not while importing the CLI, and caches it', () => {
  expect(detect).not.toHaveBeenCalled();
  expect(invocation()).toBe('npx uptide');
  expect(invocation()).toBe('npx uptide');
  expect(detect).toHaveBeenCalledTimes(1);
});

it('snapshots retry flags, overrides, quoting, and compatible next commands', () => {
  const program = new Command().exitOverride();
  const fix = program
    .command('fix [package]')
    .option('--only <package>')
    .option('--target <version>')
    .option('--max-cost <usd>')
    .option('--model <name>')
    .option('--llm')
    .option('--no-llm')
    .option('--cwd <path>')
    .option('--allow-peer <name>', '', (value, previous: string[]) => [...previous, value], [])
    .option('--verbose');
  program.command('check [package]').option('--cwd <path>').option('--verbose');
  program.command('pr').option('--branch <name>').option('--cwd <path>');
  program.parse(
    [
      'fix',
      '--only',
      'zod',
      '--target',
      '4.6.5',
      '--max-cost=3',
      '--no-llm',
      '--model',
      "model's name",
      '--cwd',
      '../my project',
      '--allow-peer',
      'one',
      '--allow-peer',
      'two',
      '--verbose',
    ],
    { from: 'user' },
  );
  expect(
    [
      'uptide fix zod plugin --target 4.6.6',
      'uptide fix zod --cwd /project/root --max-cost 2 --allow-peer replacement',
      'uptide fix stripe --pin-current-api',
      'uptide fix zod   (set a provider key first)',
      "uptide fix zod --cwd '/project --max-cost 8'",
      'uptide check zod --details',
      'uptide pr --branch uptide/zod-4.6.5',
      'npm install',
    ].map((hint) => repeatFlags(hint, fix)),
  ).toMatchSnapshot();
});

it('keeps a positive boolean flag without also suggesting its negation', () => {
  const program = new Command();
  const fix = program.command('fix').option('--llm').option('--no-llm');
  program.parse(['fix', '--llm'], { from: 'user' });
  expect(repeatFlags('uptide fix zod', fix)).toBe('uptide fix zod --llm');
});

it.each(['uptide', 'npx uptide', 'npx uptide@next'])(
  'keeps retry flags with the %s prefix',
  (invocation) => {
    const program = new Command();
    const fix = program.command('fix').option('--target <version>').option('--max-cost <usd>');
    program.parse(['fix', '--target', '4', '--max-cost', '2'], { from: 'user' });
    expect(repeatFlags(`${invocation} fix zod --target 5`, fix)).toBe(
      `${invocation} fix zod --target 5 --max-cost 2`,
    );
  },
);
