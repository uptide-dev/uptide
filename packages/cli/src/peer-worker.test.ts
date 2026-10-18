import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { uptideCommand } from '@uptide/core';
import { expect, it } from 'vitest';
import { VERSION } from './version.js';

const bin = fileURLToPath(new URL('../dist/index.js', import.meta.url));
it.skipIf(!existsSync(bin)).each([
  ['on PATH', '', true, 'uptide'],
  ['local only', '', false, uptideCommand(VERSION)],
  ['npx', 'exec', true, uptideCommand(VERSION)],
])(
  'preserves grouped peer errors and retry flags (%s)',
  async (_mode, npmCommand, onPath, invocation) => {
    const cwd = mkdtempSync(join(tmpdir(), 'uptide-peer-worker-'));
    const peers = { react: '^18', 'react-dom': '^18' };
    const server = createServer((req, res) => {
      const name = decodeURIComponent((req.url ?? '').slice(1));
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          versions:
            name === 'plugin'
              ? {
                  '1.0.0': { peerDependencies: peers },
                  '1.1.0': { peerDependencies: { react: '^19', 'react-dom': '^19' } },
                }
              : {
                  '18.2.0': { peerDependencies: name === 'react-dom' ? { react: '^18' } : {} },
                  '19.3.0': { peerDependencies: name === 'react-dom' ? { react: '^19' } : {} },
                },
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      // A global install (outside node_modules) and a project-local launcher, which must not count.
      mkdirSync(join(cwd, 'global/bin'), { recursive: true });
      symlinkSync(bin, join(cwd, 'global/bin/uptide'));
      mkdirSync(join(cwd, 'node_modules/.bin'), { recursive: true });
      symlinkSync(bin, join(cwd, 'node_modules/.bin/uptide'));
      const dependencies = { react: '18.2.0', 'react-dom': '18.2.0', plugin: '1.0.0' };
      writeFileSync(join(cwd, 'package.json'), JSON.stringify({ dependencies }));
      const packages: Record<string, object> = { '': { dependencies } };
      for (const [name, version] of Object.entries(dependencies)) {
        const manifest = {
          name,
          version,
          peerDependencies:
            name === 'plugin' ? peers : name === 'react-dom' ? { react: '^18' } : {},
        };
        mkdirSync(join(cwd, 'node_modules', name), { recursive: true });
        writeFileSync(join(cwd, 'node_modules', name, 'package.json'), JSON.stringify(manifest));
        packages[`node_modules/${name}`] = manifest;
      }
      writeFileSync(
        join(cwd, 'package-lock.json'),
        JSON.stringify({ lockfileVersion: 3, packages }),
      );
      writeFileSync(
        join(cwd, '.npmrc'),
        `registry=http://127.0.0.1:${(server.address() as AddressInfo).port}\n`,
      );
      writeFileSync(join(cwd, '.gitignore'), 'node_modules\ncache\n');
      for (const args of [
        ['init', '-q'],
        ['add', '.'],
        [
          '-c',
          'user.name=Fixture',
          '-c',
          'user.email=fixture@example.test',
          'commit',
          '-qm',
          'fixture',
        ],
      ])
        execFileSync('git', args, { cwd });
      const invoke = (json: boolean) =>
        promisify(execFile)(
          process.execPath,
          [bin, 'fix', 'react', '--target', '19.3.0', '--no-llm', ...(json ? ['--json'] : [])],
          {
            cwd,
            timeout: 10000,
            env: {
              ...Object.fromEntries(
                Object.entries(process.env).filter(([key]) => !/^npm_config_/i.test(key)),
              ),
              NPM_CONFIG_USERCONFIG: '/nonexistent',
              npm_command: npmCommand,
              PATH: onPath
                ? `${join(cwd, 'global/bin')}${delimiter}${process.env.PATH ?? ''}`
                : process.env.PATH,
              UPTIDE_TELEMETRY: '0',
              UPTIDE_INTERNAL: '1',
              UPTIDE_CACHE_DIR: join(cwd, 'cache'),
            },
          },
        ).then(
          (output) => ({ ...output, code: 0 }),
          (error: { stdout: string; stderr: string; code: number }) => error,
        );
      const result = await invoke(true);
      expect(result.code).toBe(2);
      const report = JSON.parse(result.stdout);
      expect(report.peerConflicts).toEqual([
        {
          name: 'plugin',
          version: '1.0.0',
          newer: '1.1.0',
          allowed: false,
          peers: ['react', 'react-dom'].map((peer) => ({
            peer,
            range: '^18',
            target: '19.3.0',
            version: '1.0.0',
          })),
        },
      ]);
      expect(report.next).toBe(`${invocation} fix react plugin --target 19.3.0 --no-llm --json`);
      expect(report.error.code).toBe('INCONSISTENT_UPGRADE');
      expect(result.stderr).not.toMatch(/✖|error:|LLM spend:/);
      const plain = await invoke(false);
      expect(plain.code).toBe(2);
      expect(plain.stdout).toBe('');
      expect(plain.stderr).not.toMatch(/✖|error:|LLM spend:/);
      expect(plain.stderr.slice(plain.stderr.indexOf('uptide fix · react 18.2.0'))).toBe(
        `${report.error.message.replace(' --json', '')}\n`,
      );
      expect(
        report.error.message.replace(`Next: ${invocation}`, 'Next: uptide'),
      ).toMatchInlineSnapshot(`
        "uptide fix · react 18.2.0 → 19.3.0 · 1 peer blocker to resolve first
        plugin 1.0.0  peers react, react-dom ^18  →  upgrade to 1.1.0 (accepts react 19, react-dom 19): add plugin to the command

        Next: uptide fix react plugin --target 19.3.0 --no-llm --json"
      `);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(cwd, { recursive: true, force: true });
    }
  },
  30_000,
);
