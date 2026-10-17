import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Usage } from '../domain/usage.js';
import { definePack, detectIn } from './contract.js';
import { withCompanionPacks } from './index.js';
import { REGISTRY } from './registry.js';
import { fixtureCases, fixtureVersions } from './tooling/fixtures.js';

// A pack that overrides `runtimeFindings` without running the base hook silently drops every
// rule that fires through `detect` (UPT-89). No pack is known to do so now.
const OVERRIDES_WITHOUT_BASE = new Set<string>();
// redis gates rules by the majors an upgrade crosses; the fixtures cover both.
const VERSIONS: Record<string, { from: string; to: string }> = {
  redis: { from: '4.0.0', to: '6.0.0' },
};

// A lead with no findings of its own: whatever the composite reports is the companion's (UPT-10).
const lead = definePack({
  meta: { package: 'lead', from: '^1', to: '^2', sources: [], maintainer: 'test' },
  rules: [],
  behavior: [],
  instructions: '',
});

describe.each(['alone', 'as a companion'] as const)(
  'runtimeFindings reports every detecting rule of its fixtures, %s',
  (mode) => {
    for (const { dir, pack } of REGISTRY) {
      if (OVERRIDES_WITHOUT_BASE.has(dir)) continue;
      const packDir = join(dirname(new URL(import.meta.url).pathname), dir);
      for (const name of fixtureCases(packDir)) {
        it(`${dir}: ${name}`, () => {
          const filenamePath = join(packDir, 'fixtures', name, 'filename.txt');
          const file = existsSync(filenamePath)
            ? readFileSync(filenamePath, 'utf8').trim()
            : `fixtures/${name}/before.ts`;
          const text = readFileSync(join(packDir, 'fixtures', name, 'before.ts'), 'utf8');
          const detected = detectIn(pack, file, text).map((f) => `${f.rule}:${f.line}`);
          const root = mkdtempSync(join(tmpdir(), 'uptide-runtime-'));
          try {
            mkdirSync(dirname(join(root, file)), { recursive: true });
            writeFileSync(join(root, file), text);
            const versions = VERSIONS[dir] ?? fixtureVersions(pack);
            const own = {
              ...versions,
              installedDir: '',
              targetDir: '',
              usages: [{ file } as Usage],
            };
            const read = (f: string) =>
              existsSync(join(root, f)) ? readFileSync(join(root, f), 'utf8') : undefined;
            const findings =
              (mode === 'alone'
                ? pack.runtimeFindings?.({ root, workspace: '', ...own, files: [], read })
                : // The lead's own versions and usages, the companion's beside them, as check passes them.
                  withCompanionPacks(lead, [pack]).runtimeFindings?.({
                    root,
                    workspace: '',
                    from: '1.0.0',
                    to: '2.0.0',
                    installedDir: '',
                    targetDir: '',
                    usages: [],
                    files: [],
                    read,
                    companions: [{ name: pack.name, ...own }],
                  })) ?? [];
            expect(findings.map((f) => `${f.rule}:${f.usage.line}`)).toEqual(
              expect.arrayContaining(detected),
            );
            if (mode === 'as a companion')
              for (const f of findings)
                expect([f.change.package, f.change.from, f.change.to]).toEqual([
                  pack.name,
                  versions.from,
                  versions.to,
                ]);
          } finally {
            rmSync(root, { recursive: true, force: true });
          }
        });
      }
    }
  },
);
