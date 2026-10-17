import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { packageSelected, parseUptideConfig } from './config.js';
import { loadUptideConfig } from './node.js';
import { DEFAULT_CONFIG, UPTIDE_CONFIG_SCHEMA } from './schema.js';
import { KEYWORDS } from './validate.js';

const parse = (text: string) => parseUptideConfig(text).config;
const problems = (text: string): string => {
  try {
    parseUptideConfig(text);
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('expected the file to be rejected');
};

describe('uptide.yml', () => {
  it('fills every default from `version: 1` alone', () => {
    expect(parse('version: 1\n')).toEqual(DEFAULT_CONFIG);
    expect(DEFAULT_CONFIG).toMatchObject({ maxOpenPrs: 3, maxCost: 1, executor: 'auto' });
    expect(DEFAULT_CONFIG.llm).toEqual({ enabled: true, provider: 'anthropic' });
  });

  it('reads every setting', () => {
    const config = parse(`version: 1
packages:
  allow: ['zod', '@types/*', '@aws-sdk/client-secrets-manager']
  deny: [stripe]
schedule: '5 4 * * mon-fri'
maxOpenPrs: 5
llm: { enabled: false, provider: openai }
maxCost: 2.5
executor: sdk
`);
    expect(config).toEqual({
      version: 1,
      packages: { allow: ['zod', '@types/*', '@aws-sdk/client-secrets-manager'], deny: ['stripe'] },
      schedule: '5 4 * * mon-fri',
      maxOpenPrs: 5,
      llm: { enabled: false, provider: 'openai' },
      maxCost: 2.5,
      executor: 'sdk',
    });
  });

  it('reads verify.build, a package.json script name, and rejects a command', () => {
    expect(parse('version: 1\nverify:\n  build: build-ci\n')).toMatchObject({
      verify: { build: 'build-ci' },
    });
    expect(parse('version: 1\nverify:\n  build: "build:ci"\n').verify?.build).toBe('build:ci');
    expect(problems('version: 1\nverify:\n  build: "next build"\n')).toContain(
      'line 3: verify.build',
    );
    expect(problems('version: 1\nverify:\n  command: x\n')).toContain(
      'command is not a setting here',
    );
  });

  it('names every problem with its line, in one error', () => {
    const message = problems(`version: 1
maxOpenPrs: three
llm:
  provider: mistral
executor: fast
maxCost: 0
`);
    expect(message).toContain('uptide.yml is not valid:');
    expect(message).toContain('line 2: maxOpenPrs must be a whole number, not text');
    expect(message).toContain('line 4: llm.provider must be one of anthropic, openai, gemini');
    expect(message).toContain('line 5: executor must be one of auto, patch, sdk');
    expect(message).toContain('line 6: maxCost must be more than 0 and at most 100');
    expect(message).toContain('docs/config.md');
  });

  it('rejects unknown settings, saying which exist', () => {
    expect(problems('version: 1\nschedul: "1 2 * * 1"\n')).toContain(
      'line 2: schedul is not a setting here (known: version, packages, schedule, maxOpenPrs, llm, maxCost, executor, minReleaseAgeDays, updatePins, verify)',
    );
    expect(problems('version: 1\npackages:\n  only: [zod]\n')).toContain(
      'packages.only is not a setting',
    );
  });

  it('has no draft setting: pull requests are always drafts', () => {
    expect(problems('version: 1\ndraft: false\n')).toContain(
      'draft is not a setting: Uptide pull requests are always drafts',
    );
  });

  it('requires version 1, and says when a newer uptide is needed', () => {
    expect(problems('maxOpenPrs: 2\n')).toContain('version is required');
    expect(problems('version: 2\n')).toContain('this uptide reads version 1');
    expect(problems('version: "1"\n')).toContain('version must be 1');
    expect(problems('')).toContain('the file is empty');
    expect(problems('- version: 1\n')).toContain('the file must be a mapping, not a list');
  });

  it('checks the schedule is cron GitHub accepts', () => {
    expect(problems("version: 1\nschedule: 'weekly'\n")).toContain(
      'line 2: schedule has 1 field; a cron expression has five',
    );
    expect(problems("version: 1\nschedule: '61 3 * * 1'\n")).toContain(
      'minute field "61": expected 0 to 59',
    );
    expect(problems("version: 1\nschedule: 'weekly'\n")).toContain(
      ', or manual for no scheduled runs',
    );
  });

  it('takes manual for a workflow with no schedule', () => {
    const { config } = parseUptideConfig('version: 1\nschedule: manual\n');
    expect(config.schedule).toBe('manual');
    expect(problems('version: 1\nschedule: Manual\n')).toContain('schedule has 1 field');
  });

  it('rejects package globs that are not npm names', () => {
    expect(problems('version: 1\npackages:\n  deny: ["Zod Lib"]\n')).toContain(
      'line 3: packages.deny[0] is not in the expected format',
    );
  });

  it('reports YAML errors and duplicate keys with their line', () => {
    expect(problems('version: 1\nmaxOpenPrs: 2\nmaxOpenPrs: 3\n')).toMatch(/line 3: .*unique/i);
    expect(problems('version: 1\nllm: [\n')).toMatch(/line \d+:/);
  });

  it('never accepts a credential, and never repeats one', () => {
    const key = `sk-ant-api03-${'x'.repeat(24)}`;
    const message = problems(`version: 1\nllm:\n  provider: anthropic\n  apiKey: ${key}\n`);
    expect(message).toContain('line 4: "apiKey" looks like a credential setting');
    expect(message).toContain('rotate it');
    expect(message).not.toContain(key);
    const asValue = problems(`version: 1\nschedule: "${key}"\n`);
    expect(asValue).toContain('line 2: schedule looks like a credential');
    expect(asValue).not.toContain(key);
    // A dependency whose name mentions secrets is not one.
    expect(
      parse('version: 1\npackages:\n  deny: ["@aws-sdk/client-secrets-manager"]\n'),
    ).toBeTruthy();
  });

  it('selects packages: deny wins, an empty allow means everything', () => {
    const config = parse(`version: 1
packages:
  allow: ['@radix-ui/*', zod, 'eslint*']
  deny: ['@radix-ui/react-icons']
`);
    expect(packageSelected(config, 'zod')).toBe(true);
    expect(packageSelected(config, '@radix-ui/react-dialog')).toBe(true);
    expect(packageSelected(config, '@radix-ui/react-icons')).toBe(false);
    expect(packageSelected(config, 'eslint-plugin-react')).toBe(true);
    expect(packageSelected(config, 'stripe')).toBe(false);
    expect(packageSelected(DEFAULT_CONFIG, 'anything')).toBe(true);
  });
});

describe('loadUptideConfig', () => {
  const repo = (): string => {
    const root = mkdtempSync(join(tmpdir(), 'uptide-config-'));
    mkdirSync(join(root, '.git'));
    mkdirSync(join(root, 'packages', 'api'), { recursive: true });
    return root;
  };

  it('finds the nearest uptide.yml up to the Git root, or nothing', () => {
    const root = repo();
    expect(loadUptideConfig(join(root, 'packages', 'api'))).toBeUndefined();
    writeFileSync(join(root, 'uptide.yml'), 'version: 1\nmaxOpenPrs: 7\n');
    const loaded = loadUptideConfig(join(root, 'packages', 'api'));
    expect(loaded?.path).toBe(join(root, 'uptide.yml'));
    expect(loaded?.config.maxOpenPrs).toBe(7);
    expect(loaded?.given).toEqual({ version: 1, maxOpenPrs: 7 });
  });

  it('reads --config relative to the working directory, and requires it to exist', () => {
    const root = repo();
    writeFileSync(join(root, 'ci.yml'), 'version: 1\nmaxCost: 3\n');
    expect(loadUptideConfig(root, 'ci.yml')?.config.maxCost).toBe(3);
    expect(() => loadUptideConfig(root, 'missing.yml')).toThrow(
      '--config missing.yml: no such file',
    );
  });

  it('names the file in its errors', () => {
    const root = repo();
    writeFileSync(join(root, 'uptide.yml'), 'version: 1\nmaxOpenPrs: 0\n');
    expect(() => loadUptideConfig(root)).toThrow(`${join(root, 'uptide.yml')} is not valid`);
  });
});

describe('the JSON Schema', () => {
  it('uses only keywords the loader enforces', () => {
    const used = new Set<string>();
    const walk = (node: unknown, inProperties = false): void => {
      if (!node || typeof node !== 'object' || Array.isArray(node)) return;
      for (const [key, value] of Object.entries(node)) {
        if (!inProperties) used.add(key);
        walk(value, !inProperties && key === 'properties');
      }
    };
    walk(UPTIDE_CONFIG_SCHEMA);
    expect([...used].filter((k) => !KEYWORDS.has(k))).toEqual([]);
  });

  it('is published as schema/uptide.v1.json, unchanged', () => {
    const published = JSON.parse(
      readFileSync(new URL('../../../../schema/uptide.v1.json', import.meta.url), 'utf8'),
    );
    expect(published).toEqual(JSON.parse(JSON.stringify(UPTIDE_CONFIG_SCHEMA)));
  });

  it('states the defaults the loader applies', () => {
    const p = UPTIDE_CONFIG_SCHEMA.properties;
    expect(p.maxOpenPrs.default).toBe(DEFAULT_CONFIG.maxOpenPrs);
    expect(p.maxCost.default).toBe(DEFAULT_CONFIG.maxCost);
    expect(p.schedule.default).toBe(DEFAULT_CONFIG.schedule);
    expect(p.executor.default).toBe(DEFAULT_CONFIG.executor);
    expect(p.llm.properties.enabled.default).toBe(DEFAULT_CONFIG.llm.enabled);
    expect(p.llm.properties.provider.default).toBe(DEFAULT_CONFIG.llm.provider);
  });
});

it('accepts the root-pin opt-out and rejects non-boolean values', () => {
  expect(parse('version: 1\nupdatePins: false\n').updatePins).toBe(false);
  expect(parse('version: 1\nupdatePins: true\n').updatePins).toBe(true);
  expect(problems('version: 1\nupdatePins: "false"\n')).toContain(
    'updatePins must be true or false',
  );
});
