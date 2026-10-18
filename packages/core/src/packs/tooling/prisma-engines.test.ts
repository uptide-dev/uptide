import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { binaryTarget, prismaEngineEnv } from './prisma-engines.js';

const HASH = '0edf323efd1d98336f3f0a68684b56f689b900d3';
const TARGET = 'debian-openssl-3.0.x';

/** A project with Prisma `version` installed, its engine commit where Prisma's own packages keep it. */
function project(version: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'uptide-engines-'));
  const pkg = (name: string, extra: object = {}) => {
    mkdirSync(join(dir, 'node_modules', name), { recursive: true });
    writeFileSync(
      join(dir, 'node_modules', name, 'package.json'),
      JSON.stringify({ name, version, ...extra }),
    );
  };
  pkg('prisma');
  pkg('@prisma/engines');
  pkg('@prisma/engines-version', { prisma: { enginesVersion: HASH } });
  return dir;
}

/** binaries.prisma.sh, recorded: each file's gzip and its sha256. */
function server(files: Record<string, string>, tamper = false) {
  const asked: string[] = [];
  const fetcher = (async (url: string) => {
    asked.push(url);
    const name = url.replace(`https://binaries.prisma.sh/all_commits/${HASH}/${TARGET}/`, '');
    const file = name.replace(/\.gz(\.sha256)?$/, '');
    if (!(file in files)) return new Response('', { status: 404 });
    const gz = gzipSync(files[file] as string);
    const body = name.endsWith('.sha256')
      ? `${createHash('sha256')
          .update(tamper ? 'other' : gz)
          .digest('hex')}  ${file}.gz\n`
      : gz;
    return new Response(body);
  }) as typeof fetch;
  return { fetcher, asked };
}

describe('prismaEngineEnv (UPT-95)', () => {
  const made: string[] = [];
  const temp = (dir: string) => {
    made.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('fetches the schema engine Prisma 7 names, verified, and points Prisma at it', async () => {
    const store = temp(mkdtempSync(join(tmpdir(), 'uptide-store-')));
    const { fetcher, asked } = server({ 'schema-engine': 'engine 7' });
    const env = await prismaEngineEnv([temp(project('7.10.0'))], store, undefined, fetcher, TARGET);
    expect(env).toEqual({
      PRISMA_SCHEMA_ENGINE_BINARY: join(store, HASH, TARGET, 'schema-engine'),
    });
    expect(readFileSync(env.PRISMA_SCHEMA_ENGINE_BINARY as string, 'utf8')).toBe('engine 7');
    // Kept: the next repository on the same engines fetches nothing.
    asked.length = 0;
    await prismaEngineEnv([temp(project('7.10.0'))], store, undefined, fetcher, TARGET);
    expect(asked).toEqual([]);
  });

  it('adds the query engine library for Prisma 5 and 6', async () => {
    const store = temp(mkdtempSync(join(tmpdir(), 'uptide-store-')));
    const { fetcher } = server({ 'schema-engine': 's', 'libquery_engine.so.node': 'q' });
    const env = await prismaEngineEnv([temp(project('6.19.0'))], store, undefined, fetcher, TARGET);
    expect(Object.keys(env).sort()).toEqual([
      'PRISMA_QUERY_ENGINE_LIBRARY',
      'PRISMA_SCHEMA_ENGINE_BINARY',
    ]);
  });

  it('sets nothing when a download does not match its sha256, or there is no Prisma', async () => {
    const store = temp(mkdtempSync(join(tmpdir(), 'uptide-store-')));
    const lines: string[] = [];
    const { fetcher } = server({ 'schema-engine': 'engine' }, true);
    const log = (l: string) => lines.push(l);
    expect(await prismaEngineEnv([temp(project('7.10.0'))], store, log, fetcher, TARGET)).toEqual(
      {},
    );
    expect(lines.join('\n')).toMatch(/sha256 does not match/);
    const none = temp(mkdtempSync(join(tmpdir(), 'uptide-engines-')));
    expect(await prismaEngineEnv([none], store, undefined, fetcher, TARGET)).toEqual({});
  });
});

it('names the binary target Prisma downloads for', () => {
  const ubuntu = () => 'ID=ubuntu\nID_LIKE=debian\n';
  expect(binaryTarget('linux', 'x64', () => '3.0.x', ubuntu)).toBe('debian-openssl-3.0.x');
  expect(binaryTarget('linux', 'arm64', () => '3.0.x', ubuntu)).toBe('linux-arm64-openssl-3.0.x');
  expect(
    binaryTarget(
      'linux',
      'x64',
      () => '1.1.x',
      () => 'ID="rhel"\n',
    ),
  ).toBe('rhel-openssl-1.1.x');
  expect(
    binaryTarget(
      'linux',
      'x64',
      () => '3.0.x',
      () => 'ID=alpine\n',
    ),
  ).toBe('linux-musl-openssl-3.0.x');
  expect(binaryTarget('darwin', 'arm64')).toBe('darwin-arm64');
  expect(binaryTarget('linux', 'x64', () => undefined, ubuntu)).toBeUndefined();
});
