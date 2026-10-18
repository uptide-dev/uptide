import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';

/**
 * Prisma's CLI downloads its engines on first use when the install script did not run, and
 * ground truth keeps generators off the network (UPT-95). So before any repository code runs,
 * uptide fetches the engines the locked Prisma names itself: the commit from
 * `@prisma/engines-version` (read as data, never executed), the files from binaries.prisma.sh,
 * checked against their published sha256. Prisma then uses them through its documented
 * `PRISMA_SCHEMA_ENGINE_BINARY` and `PRISMA_QUERY_ENGINE_LIBRARY` variables. Prisma 7 needs the
 * schema engine only; 5 and 6 also the query engine library. Nothing fetched (no Prisma, an
 * older one, an unknown platform, a failed download) means no variables: the generator then
 * fails on the blocked mirror, and `pack test` fails that repository.
 */
export async function prismaEngineEnv(
  /** The installed project and its workspaces: where `node_modules/prisma` may be. */
  dirs: string[],
  /** Where fetched engines are kept, shared by every repository. */
  store: string,
  log?: (line: string) => void,
  fetcher: typeof fetch = fetch,
  target = binaryTarget(),
): Promise<Record<string, string>> {
  const locked = new Map<string, number>();
  for (const dir of dirs) {
    const prisma = findPackage(dir, 'prisma');
    if (!prisma) continue;
    const major = Number(readJson(join(prisma, 'package.json'))?.version?.split('.')[0]);
    const engines = findPackage(prisma, '@prisma/engines');
    const version = engines && findPackage(engines, '@prisma/engines-version');
    const hash = version && readJson(join(version, 'package.json'))?.prisma?.enginesVersion;
    if (major >= 5 && hash && /^[0-9a-f]{40}$/.test(hash)) locked.set(hash, major);
  }
  // ponytail: one Prisma per repository; two versions would need per-workspace variables.
  if (locked.size !== 1 || !target) return {};
  const [[hash, major]] = [...locked] as [[string, number]];
  const files: [string, string][] = [['PRISMA_SCHEMA_ENGINE_BINARY', schemaEngine(target)]];
  if (major < 7) files.push(['PRISMA_QUERY_ENGINE_LIBRARY', queryLibrary(target)]);
  const env: Record<string, string> = {};
  for (const [name, file] of files) {
    const path = join(store, hash, target, file);
    if (!existsSync(path)) {
      try {
        await download(
          `https://binaries.prisma.sh/all_commits/${hash}/${target}/${file}.gz`,
          path,
          fetcher,
        );
        log?.(`fetched prisma engine ${file} (${hash.slice(0, 12)}, ${target})`);
      } catch (err) {
        log?.(`prisma engine ${file} not fetched: ${(err as Error).message}`);
        return {};
      }
    }
    env[name] = path;
  }
  return env;
}

async function download(url: string, path: string, fetcher: typeof fetch): Promise<void> {
  const get = async (u: string): Promise<Buffer> => {
    const res = await fetcher(u, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`${u}: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  };
  const [gz, sum] = await Promise.all([get(url), get(`${url}.sha256`)]);
  const expected = sum.toString('utf8').trim().split(/\s+/)[0];
  if (createHash('sha256').update(gz).digest('hex') !== expected)
    throw new Error(`${url}: sha256 does not match`);
  mkdirSync(dirname(path), { recursive: true });
  const partial = `${path}.partial-${process.pid}`;
  writeFileSync(partial, gunzipSync(gz));
  chmodSync(partial, 0o755);
  renameSync(partial, path);
}

/** Node's lookup of `name` from `from`: each ancestor's `node_modules`, real paths (pnpm). */
function findPackage(from: string, name: string): string | undefined {
  for (let at = realpathSync(from); ; at = dirname(at)) {
    const dir = join(at, 'node_modules', name);
    if (existsSync(join(dir, 'package.json'))) return realpathSync(dir);
    if (dirname(at) === at) return undefined;
  }
}

function readJson(
  path: string,
): { version?: string; prisma?: { enginesVersion?: string } } | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

const schemaEngine = (target: string): string =>
  target === 'windows' ? 'schema-engine.exe' : 'schema-engine';

function queryLibrary(target: string): string {
  if (target === 'windows') return 'query_engine.dll.node';
  return target.startsWith('darwin') ? 'libquery_engine.dylib.node' : 'libquery_engine.so.node';
}

/**
 * Prisma's binary target for this machine (`debian-openssl-3.0.x`, `darwin-arm64`), as its
 * `@prisma/get-platform` names it on the platforms CI and contributors run; undefined where
 * it cannot tell, and then nothing is fetched.
 */
export function binaryTarget(
  platform: string = process.platform,
  arch: string = process.arch,
  openssl: () => string | undefined = opensslVersion,
  osRelease: () => string = () => readFileSync('/etc/os-release', 'utf8'),
): string | undefined {
  if (platform === 'darwin') return arch === 'arm64' ? 'darwin-arm64' : 'darwin';
  if (platform === 'win32') return 'windows';
  if (platform !== 'linux') return undefined;
  const ssl = openssl();
  if (!ssl) return undefined;
  let ids = '';
  try {
    ids = (osRelease().match(/^ID(?:_LIKE)?=.*$/gm) ?? []).join(' ');
  } catch {}
  if (/alpine/.test(ids))
    return arch === 'arm64' ? `linux-musl-arm64-openssl-${ssl}` : `linux-musl-openssl-${ssl}`;
  if (arch === 'arm64') return `linux-arm64-openssl-${ssl}`;
  return /rhel|centos|fedora/.test(ids) ? `rhel-openssl-${ssl}` : `debian-openssl-${ssl}`;
}

/** `OpenSSL 3.0.13 …` → `3.0.x`, `OpenSSL 1.1.1w …` → `1.1.x`. */
function opensslVersion(): string | undefined {
  try {
    const out = execFileSync('openssl', ['version'], { encoding: 'utf8', timeout: 10_000 });
    const m = /OpenSSL (\d+)\.(\d+)/.exec(out);
    if (!m) return undefined;
    return m[1] === '1' ? `1.${m[2]}.x` : `${m[1]}.0.x`;
  } catch {
    return undefined;
  }
}
