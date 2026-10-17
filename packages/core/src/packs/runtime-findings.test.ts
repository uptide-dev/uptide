import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Usage } from '../domain/usage.js';
import { detectIn } from './contract.js';
import { REGISTRY } from './registry.js';
import { fixtureCases, fixtureVersions } from './tooling/fixtures.js';

// A pack that overrides `runtimeFindings` without running the base hook silently drops every
// rule that fires through `detect` (UPT-89). zod is the known case; UPT-86 fixes it.
const OVERRIDES_WITHOUT_BASE = new Set(['zod']);
// redis gates rules by the majors an upgrade crosses; the fixtures cover both.
const VERSIONS: Record<string, { from: string; to: string }> = {
  redis: { from: '4.0.0', to: '6.0.0' },
};

describe('runtimeFindings reports every detecting rule of its fixtures', () => {
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
          const found = (
            pack.runtimeFindings?.({
              root,
              workspace: '',
              ...(VERSIONS[dir] ?? fixtureVersions(pack)),
              installedDir: '',
              targetDir: '',
              usages: [{ file } as Usage],
              files: [],
              read: (f) =>
                existsSync(join(root, f)) ? readFileSync(join(root, f), 'utf8') : undefined,
            }) ?? []
          ).map((f) => `${f.rule}:${f.usage.line}`);
          expect(found).toEqual(expect.arrayContaining(detected));
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      });
    }
  }
});
