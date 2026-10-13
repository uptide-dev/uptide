// `uptide/onboarding` as a consumer gets it: from the packed tarball, installed with npm.
// 1. Plain Node ESM imports both entries and generates the "Add Uptide" files.
// 2. esbuild bundles `uptide/onboarding` for the browser: no fs, path or other Node builtin
//    may be reached, and the bundle runs.
// Usage: pnpm smoke:onboarding
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const cli = join(here, '..');
function run(bin, args, cwd) {
  const result = spawnSync(bin, args, { cwd, stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    console.error(
      `smoke:onboarding: ${bin} ${args.join(' ')} failed (${result.error?.message ?? result.signal ?? result.status})`,
    );
    process.exit(1);
  }
}

run('pnpm', ['exec', 'turbo', 'run', 'build', '--filter=uptide'], join(cli, '../..'));
const out = mkdtempSync(join(tmpdir(), 'uptide-onboarding-smoke-'));
// `pnpm pack` rewrites workspace: specifiers, as `pnpm publish` will.
run('pnpm', ['pack', '--pack-destination', out], cli);
const tarball = readdirSync(out).find((f) => f.endsWith('.tgz'));
const app = join(out, 'app');
mkdirSync(app);
writeFileSync(join(app, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
// Its declared dependencies come from the registry, as for any consumer.
run('npm', ['install', join(out, tarball), '--ignore-scripts', '--no-audit', '--no-fund'], app);

// 1. Plain Node ESM: no bundler, no loader, no require() in sight.
const snapshot = {
  slug: 'acme/shop',
  defaultBranch: 'main',
  files: {
    'package.json': '{"name":"shop","packageManager":"pnpm@10.17.1"}',
    'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
  },
};
writeFileSync(
  join(app, 'node.mjs'),
  `import { generateOnboarding, repoFacts, WORKFLOW_PATH } from 'uptide/onboarding';
import { loadUptideConfig, snapshotFromDisk } from 'uptide/onboarding/node';
import { mkdirSync, writeFileSync } from 'node:fs';
const files = generateOnboarding(repoFacts(${JSON.stringify(snapshot)})).files;
if (!files.some((f) => f.path === WORKFLOW_PATH)) throw new Error('no workflow generated');
mkdirSync('repo');
writeFileSync('repo/package.json', ${JSON.stringify(snapshot.files['package.json'])});
writeFileSync('repo/pnpm-lock.yaml', ${JSON.stringify(snapshot.files['pnpm-lock.yaml'])});
writeFileSync('repo/uptide.yml', 'version: 1\\nmaxCost: 3\\n');
if (loadUptideConfig('repo')?.config.maxCost !== 3) throw new Error('uptide.yml not read');
repoFacts(snapshotFromDisk('repo', { slug: 'acme/shop', defaultBranch: 'main' }));
console.log('smoke:onboarding: plain Node ESM imports both entries');
`,
);
run(process.execPath, ['node.mjs'], app);

// 2. A browser bundle of the pure entry, with the esbuild the build itself uses.
const esbuild = createRequire(createRequire(join(cli, 'package.json')).resolve('tsup')).resolve(
  'esbuild',
);
const { build } = await import(esbuild);
const result = await build({
  stdin: {
    contents: `import { generateOnboarding, repoFacts } from 'uptide/onboarding';
globalThis.files = generateOnboarding(repoFacts(${JSON.stringify(snapshot)})).files.length;`,
    resolveDir: app,
  },
  bundle: true,
  platform: 'browser',
  format: 'esm',
  write: false,
  metafile: true,
  logLevel: 'error',
});
const node = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
const reached = Object.values(result.metafile.inputs).flatMap((i) =>
  i.imports.map((d) => d.path).filter((p) => node.has(p)),
);
if (reached.length) {
  console.error(`smoke:onboarding: the browser bundle reaches ${[...new Set(reached)].join(', ')}`);
  process.exit(1);
}
const bundle = join(out, 'browser.mjs');
writeFileSync(bundle, `${result.outputFiles[0].text}\nif (!globalThis.files) process.exit(1);\n`);
run(process.execPath, [bundle], app);
console.log('smoke:onboarding: the browser bundle builds without fs and runs');
