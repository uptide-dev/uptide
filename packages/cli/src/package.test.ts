import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SDK_VERSION } from '@uptide/core';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(`${root}package.json`, 'utf8'));
const bin = `${root}dist/index.js`;

describe('published package', () => {
  it('is one package named uptide whose only runtime dependency is yaml', () => {
    expect(manifest.name).toBe('uptide');
    expect(manifest.bin).toEqual({ uptide: './dist/index.js' });
    // The command inlines everything. `uptide/onboarding` imports yaml instead: bundled, its
    // CommonJS build calls require("process"), which breaks consumers' ES module builds.
    expect(Object.keys(manifest.dependencies)).toEqual(['yaml']);
    expect(manifest.devDependencies?.yaml).toBeUndefined();
    // Never installed with uptide: an SDK next to it wins, else the first fix that needs it
    // installs SDK_VERSION, the version the tests run, into Uptide's cache.
    expect(manifest.peerDependencies).toEqual({
      '@anthropic-ai/claude-agent-sdk': `>=${SDK_VERSION}`,
    });
    expect(manifest.devDependencies['@anthropic-ai/claude-agent-sdk']).toBe(SDK_VERSION);
    expect(manifest.peerDependenciesMeta).toEqual({
      '@anthropic-ai/claude-agent-sdk': { optional: true },
    });
    expect(manifest.engines.node).toBe('>=20');
    // Library entries besides the command, for the GitHub App and the Uptide app
    // (libs-export.test.ts): the pure onboarding generator, what reads it from disk, and the
    // run report with its schema.
    expect(manifest.exports).toEqual({
      './onboarding': {
        types: './dist/onboarding/index.d.ts',
        import: './dist/onboarding/index.js',
      },
      './onboarding/node': {
        types: './dist/onboarding/node.d.ts',
        import: './dist/onboarding/node.js',
      },
      './report': {
        types: './dist/report/index.d.ts',
        import: './dist/report/index.js',
      },
      './report/schema.json': './dist/report/schema.json',
      './package.json': './package.json',
    });
    // The bundle, the legal assets that must travel with it, and nothing of the build.
    expect(manifest.files).toEqual([
      'dist',
      '!dist/**/metafile-*.json',
      'NOTICE',
      'THIRD-PARTY-NOTICES',
    ]);
  });

  // `turbo run test` builds first; a bare `vitest` on a fresh clone has no dist yet.
  it.skipIf(!existsSync(bin))('bundles the engine and its worker into dist', () => {
    const files = readdirSync(`${root}dist`);
    const code = files.filter((f) => f.endsWith('.js'));
    // The engine resolves `./worker.js` relative to its own chunk: everything stays flat.
    expect(code).toContain('worker.js');
    expect(code).toContain('list-worker.js');
    // Beside the bundle, only the bundler's record of what went into it, which
    // scripts/third-party-notices.mjs reads and `files` keeps out of the tarball, and the
    // separate `uptide/onboarding` and `uptide/report` entries.
    expect(files.filter((f) => !f.endsWith('.js')).sort()).toEqual([
      'metafile-esm.json',
      'onboarding',
      'report',
    ]);
    const sources = code.map((f) => readFileSync(`${root}dist/${f}`, 'utf8')).join('\n');
    expect(sources).not.toMatch(/from\s*["']@uptide\/core["']/);
    expect(sources).not.toMatch(
      /from\s*["'](ts-morph|commander|picocolors|semver|ignore|picomatch)["']/,
    );
    // Not open source: imported at run time, never inlined (it once came in through core's dist).
    expect(sources).toMatch(/import\(\s*["']@anthropic-ai\/claude-agent-sdk["']\s*\)/);
    expect(sources).not.toMatch(/Anthropic PBC|claude-agent-sdk-darwin-arm64/);
  });

  it.skipIf(!existsSync(bin))('reports the package version, not the engine constant', () => {
    const out = execFileSync(process.execPath, [bin, '--version'], { encoding: 'utf8' });
    expect(out.trim()).toBe(manifest.version);
  });
});

it.skipIf(!existsSync(bin))(
  'embeds the build-time manifest version in --version, HTML and telemetry',
  () => {
    const root = mkdtempSync(join(tmpdir(), 'uptide-installed-version-'));
    try {
      cpSync(`${fileURLToPath(new URL('..', import.meta.url))}dist`, join(root, 'dist'), {
        recursive: true,
      });
      const version = manifest.version;
      const changedAfterBuild = '0.9.8-next.20261004';
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({ name: 'uptide', version: changedAfterBuild, type: 'module' }),
      );
      const consumer = join(root, 'consumer');
      mkdirSync(consumer);
      writeFileSync(join(consumer, 'package.json'), '{"name":"empty-app"}');
      writeFileSync(join(consumer, 'package-lock.json'), '{}');
      const installed = join(root, 'dist/index.js');
      expect(
        execFileSync(process.execPath, [installed, '--version'], { encoding: 'utf8' }).trim(),
      ).toBe(version);
      execFileSync(process.execPath, [installed, 'list', '--html', 'report.html', '--ci'], {
        cwd: consumer,
        env: {
          ...process.env,
          XDG_CONFIG_HOME: join(root, 'config'),
          UPTIDE_TELEMETRY: '1',
          // Save the local event without contacting a telemetry service.
          UPTIDE_TELEMETRY_HOST: 'http://disabled.invalid',
        },
        stdio: 'pipe',
      });
      expect(readFileSync(join(consumer, 'report.html'), 'utf8')).toContain(
        `Uptide CLI ${version}`,
      );
      const event = JSON.parse(
        readFileSync(join(root, 'config/uptide/telemetry-last.json'), 'utf8'),
      );
      expect(event.properties.version).toBe(version);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  // Copying the bundle and starting two real CLI processes exceeds 5 s under suite load.
  10_000,
);
