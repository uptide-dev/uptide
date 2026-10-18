import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { PINNED_ACTIONS, type PinnedAction, UPTIDE_ACTION } from './actions.js';

/** The commit a tag names on GitHub, through an annotated tag when there is one. */
function tagCommit(action: PinnedAction): string | undefined {
  const lines = execFileSync(
    'git',
    ['ls-remote', `https://github.com/${action.repo}.git`, `refs/tags/${action.tag}*`],
    { encoding: 'utf8', timeout: 30_000 },
  ).split('\n');
  const find = (ref: string) => lines.find((l) => l.endsWith(`\t${ref}`))?.split('\t')[0];
  return find(`refs/tags/${action.tag}^{}`) ?? find(`refs/tags/${action.tag}`);
}

// The generated workflow says `# v7.0.1` next to each SHA: the comment must not lie.
describe.skipIf(!process.env.UPTIDE_NETWORK)('pinned actions', () => {
  for (const action of [...Object.values(PINNED_ACTIONS), UPTIDE_ACTION])
    it(`${action.repo} ${action.tag} is ${action.sha.slice(0, 12)}`, () => {
      expect(action.sha).toMatch(/^[0-9a-f]{40}$/);
      expect(tagCommit(action)).toBe(action.sha);
    });
});

it('pins the Uptide Action in this repository by a release tag', () => {
  expect(UPTIDE_ACTION.repo).toBe('uptide-dev/uptide');
  expect(UPTIDE_ACTION.tag).toMatch(/^v\d+\.\d+\.\d+$/);
  expect(UPTIDE_ACTION.sha).toMatch(/^[0-9a-f]{40}$/);
  expect(UPTIDE_ACTION).toMatchObject({
    sha: '63b7c9b88838312a8b3965c87cbdc55702306d98',
    tag: 'v0.16.0',
    released: true,
  });
});

/** The commit a tag names in this checkout, or undefined when the tag was not fetched. */
function localTagCommit(tag: string): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', '--verify', '--quiet', `${tag}^{commit}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

const localPin = localTagCommit(UPTIDE_ACTION.tag);
it.skipIf(!localPin)(`pins the commit ${UPTIDE_ACTION.tag} names in this checkout`, () => {
  expect(UPTIDE_ACTION.sha).toBe(localPin);
});
