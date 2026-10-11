// What a run of the Release workflow does (.github/workflows/release.yml), as GitHub
// Actions outputs: `pending` (changesets wait to be versioned), `version` (the committed
// CLI version) and `channel` (`latest`, `next` or empty for nothing to publish).
//
//   EVENT=push|workflow_dispatch node scripts/release-plan.mjs >> "$GITHUB_OUTPUT"
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A version bump on main publishes latest; other pushes publish next. Pending CLI changesets
 * independently request a version PR. Dispatch retries latest after an automatic failure.
 */
export function releasePlan({ event, pending, version, previousVersion, published }) {
  const stable = event === 'workflow_dispatch' || version !== previousVersion;
  const channel = stable ? (!published.includes(version) ? 'latest' : '') : 'next';
  return { pending, version, channel };
}

/** Changesets with empty frontmatter (or only ignored packages) cannot version the CLI. */
export function hasCliChangeset(markdown) {
  const frontmatter = /^---\r?\n([\s\S]*?)^---\s*$/m.exec(markdown)?.[1] ?? '';
  return /^\s*["']?uptide["']?\s*:\s*["']?(patch|minor|major)["']?\s*(?:#.*)?$/m.test(frontmatter);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const pending = readdirSync(`${root}.changeset`).some(
    (file) =>
      file.endsWith('.md') &&
      file !== 'README.md' &&
      hasCliChangeset(readFileSync(`${root}.changeset/${file}`, 'utf8')),
  );
  const { version } = JSON.parse(readFileSync(`${root}packages/cli/package.json`, 'utf8'));
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: this standalone CI step runs outside Turbo.
  const event = process.env.EVENT;
  // Checkout fetches the first parent too. Missing history fails instead of guessing a channel.
  const previousVersion =
    event === 'push'
      ? JSON.parse(
          execFileSync('git', ['show', 'HEAD^:packages/cli/package.json'], {
            cwd: root,
            encoding: 'utf8',
          }),
        ).version
      : undefined;
  // A registry error fails the run: guessing "unpublished" would only fail later, at publish.
  const published = JSON.parse(
    execFileSync('npm', ['view', 'uptide', 'versions', '--json'], { encoding: 'utf8' }),
  );
  const plan = releasePlan({ event, pending, version, previousVersion, published });
  for (const [key, value] of Object.entries(plan)) console.log(`${key}=${value}`);
  console.error(
    plan.channel
      ? `uptide@${version}: publish under ${plan.channel}${pending ? ' (changesets pending)' : ''}`
      : `uptide@${version} is on npm${pending ? '; changesets pending' : ''}: nothing to publish`,
  );
}
