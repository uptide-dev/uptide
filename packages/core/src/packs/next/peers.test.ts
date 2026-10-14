import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { peerPreflight } from '../../fix/peer-preflight.js';
import { nextPack } from './index.js';

// Published manifests read 2026-10-13; the rejecting plugin is explicitly synthetic.
// next-i18next@15.4.3 really accepts Next 16: do not fabricate a restrictive peer for it.
it.each([
  ['next-i18next', '15.4.3', '>= 12.0.0', false],
  ['next-rejecting-plugin', '1.0.0', '^15.0.0', true],
])('preflights %s against Next 16 before publication', async (name, version, range, rejects) => {
  const root = mkdtempSync(join(tmpdir(), 'uptide-next-peers-'));
  const versions: Record<string, Record<string, { peerDependencies?: Record<string, string> }>> = {
    next: {
      '15.5.14': {},
      '16.4.0': {
        peerDependencies: { react: '^18.2.0 || 19.0.0-rc-de68d2f4-20241204 || ^19.0.0' },
      },
    },
    [name]: { [version]: { peerDependencies: { next: range } } },
  };
  try {
    const dependencies = { next: '15.5.14', [name]: version };
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'next-peer-consumer', dependencies }),
    );
    const packages: Record<string, unknown> = { '': { dependencies } };
    for (const [dep, at] of Object.entries(dependencies)) {
      const dir = join(root, 'node_modules', dep);
      mkdirSync(dir, { recursive: true });
      const manifest = { name: dep, version: at, ...versions[dep]?.[at] };
      writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
      packages[`node_modules/${dep}`] = manifest;
    }
    writeFileSync(
      join(root, 'package-lock.json'),
      JSON.stringify({ lockfileVersion: 3, packages }),
    );
    const planned = peerPreflight(
      { cwd: root, only: 'next', target: '16.4.0', pack: nextPack, pr: true },
      {
        manifests: async (dep) => versions[dep] ?? {},
        resolve: async () => '16.4.0',
        check: async () => {
          throw new Error('preflight must not run check');
        },
        install: async () => {
          throw new Error('preflight must not install');
        },
        diagnostics: () => {
          throw new Error('preflight must not compile');
        },
        tests: async () => {
          throw new Error('preflight must not run tests');
        },
      },
    );
    if (rejects) await expect(planned).rejects.toMatchObject({ code: 'INCONSISTENT_UPGRADE' });
    else expect((await planned)?.conflicts).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
