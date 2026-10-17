// The tarball about to be published suggests commands that reach it. Installed into a
// project, its node_modules/.bin is not on the user's PATH, so it suggests the portable form:
// `npx uptide@next` from a `next` snapshot, `npx uptide` from a `latest` release. Installed
// globally, on PATH, it suggests plain `uptide`. Release runs this on the packed CLI after the
// version to publish is applied (.github/workflows/release.yml), so it proves the artifact,
// not the tree the tests ran on; `pnpm smoke` runs it on every PR. It needs Node, npm and git;
// the runs themselves are offline (`fix` in a bun repository stops before any network).
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { expectedInvocation, invocationFailures } from './check-output.mjs';

const tarball = process.argv[2];
if (!tarball) {
  console.error('usage: node packages/cli/smoke/check-invocation.mjs <tarball>');
  process.exit(2);
}
const scratch = mkdtempSync(join(tmpdir(), 'uptide-invocation-'));
const npmInstall = (...args) =>
  execFileSync(
    'npm',
    [
      'install',
      ...args,
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--silent',
      resolve(tarball),
    ],
    { stdio: 'inherit' },
  );
try {
  // `npm_command=exec` pins hints to the portable form (uptideInvocation): not this check's.
  const { npm_command: _, ...base } = process.env;
  const repo = join(scratch, 'repo');
  execFileSync('git', ['init', '--quiet', repo]);
  writeFileSync(
    join(repo, 'package.json'),
    '{"name":"invocation","dependencies":{"zod":"3.23.8"}}\n',
  );
  writeFileSync(join(repo, 'bun.lock'), '{}\n');

  const local = join(scratch, 'local');
  npmInstall('--prefix', local);
  const global = join(scratch, 'global');
  npmInstall('--global', '--prefix', global);
  const globalBin = process.platform === 'win32' ? global : join(global, 'bin');
  // The version npm will publish it under, and the one the build says it is: a tarball
  // packed without rebuilding after the snapshot version would disagree.
  const version = JSON.parse(
    readFileSync(join(local, 'node_modules/uptide/package.json'), 'utf8'),
  ).version;
  const cases = [
    // A package manager's run puts the project's .bin on PATH; it is still not the user's.
    { name: 'installed in a project', bin: join(local, 'node_modules/.bin'), onPath: false },
    { name: 'installed globally, on PATH', bin: globalBin, onPath: true },
  ];
  const failures = [];
  const seen = [];
  for (const { name, bin, onPath } of cases) {
    const env = {
      ...base,
      PATH: `${bin}${delimiter}${base.PATH ?? ''}`,
      UPTIDE_TELEMETRY: '0',
      CI: '',
    };
    const uptide = join(bin, 'uptide');
    const built = execFileSync(uptide, ['--version'], { encoding: 'utf8', env }).trim();
    if (built !== version)
      failures.push(
        `${name}: uptide --version says ${built}, the package is ${version}: rebuild after setting the version`,
      );
    const expected = expectedInvocation(version, onPath);
    const run = spawnSync(uptide, ['fix', '--only', 'zod'], { cwd: repo, encoding: 'utf8', env });
    const output = `${run.stdout}${run.stderr}`;
    const what = `fix in a bun repository, ${name}`;
    if (run.status !== 2) failures.push(`${what}: exit ${run.status}, wanted 2\n${output}`);
    if (!output.includes(`Next: ${expected} check zod --details`))
      failures.push(`${what}: expected "Next: ${expected} check zod --details"\n${output}`);
    failures.push(...invocationFailures(what, output, version, onPath));
    seen.push(`${name}: ${output.match(/Next: .*/)?.[0]}`);
  }
  if (failures.length) {
    console.error(
      `uptide ${version}: ${failures.length} failed assertion(s)\n\n${failures.join('\n\n')}`,
    );
    process.exit(1);
  }
  console.log(`uptide ${version} suggests commands that reach it\n  ${seen.join('\n  ')}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
