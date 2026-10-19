import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { projectForDependency } from './projects.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture(files: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'uptide-projects-'));
  roots.push(root);
  for (const [file, contents] of Object.entries({ 'package.json': '{"name":"tools"}', ...files })) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), contents);
  }
  return root;
}
const manifest = '{"devDependencies":{"vitest":"^4.0.0"}}';

it.each(['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock'])(
  'finds a nested install root using %s without installed dependencies',
  (lock) => {
    const root = fixture({ 'apps/frontend/package.json': manifest, [`apps/frontend/${lock}`]: '' });
    expect(projectForDependency(root, ['vitest'])).toBe(join(root, 'apps/frontend'));
  },
);
it('preserves root and declared workspace selection', () => {
  const cases: Record<string, string>[] = [
    { 'package.json': manifest },
    { 'package.json': '{"workspaces":["packages/*"]}', 'packages/ui/package.json': manifest },
  ];
  for (const files of cases) {
    const root = fixture({
      ...files,
      'frontend/package.json': manifest,
      'frontend/package-lock.json': '',
    });
    expect(projectForDependency(root, ['vitest'])).toBe(root);
  }
});
it('selects a nested workspace root rather than its member with a stray lockfile', () => {
  const root = fixture({
    'frontend/package.json': '{"workspaces":["packages/*"]}',
    'frontend/package-lock.json': '',
    'frontend/packages/ui/package.json': manifest,
    'frontend/packages/ui/package-lock.json': '',
  });
  expect(projectForDependency(root, ['vitest'])).toBe(join(root, 'frontend'));
});
it('names every candidate instead of choosing between independent projects', () => {
  const root = fixture({
    'frontend/package.json': manifest,
    'frontend/package-lock.json': '',
    'backend/package.json': manifest,
    'backend/pnpm-lock.yaml': '',
  });
  expect(() => projectForDependency(root, ['vitest'])).toThrow(
    'vitest is declared in multiple independent projects: backend/package.json, frontend/package.json; run from the intended directory or pass --cwd <directory>',
  );
});
it('ignores dependencies, build output, hidden, gitignored and symlinked directories, and manifests without a lockfile', () => {
  const files: Record<string, string> = {
    '.gitignore': 'ignored/\n',
    'apps/.gitignore': 'local/\n',
    'unlocked/package.json': manifest,
  };
  for (const dir of [
    'node_modules/dep',
    'dist/example',
    '.cache/example',
    'ignored',
    'apps/local',
  ]) {
    files[`${dir}/package.json`] = manifest;
    files[`${dir}/package-lock.json`] = '';
  }
  const root = fixture(files);
  const outside = fixture({ 'package.json': manifest, 'package-lock.json': '' });
  symlinkSync(outside, join(root, 'linked'), 'dir');
  expect(projectForDependency(root, ['vitest'])).toBe(root);
});
it('accepts alternate package names and all direct dependency fields', () => {
  for (const field of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    const root = fixture({
      'frontend/package.json': JSON.stringify({ [field]: { 'router-dom': '^6' } }),
      'frontend/package-lock.json': '',
    });
    expect(projectForDependency(root, ['router', 'router-dom'])).toBe(join(root, 'frontend'));
  }
});
