import type { GitAuthor } from './engine.js';
import type { Fetch } from './oidc.js';

/**
 * The head branches of this repository's open pull requests that Uptide opened
 * (`uptide/<package>-<version>`): what `maxOpenPrs` counts, and what is not fixed again.
 */
export async function openUptideBranches(options: {
  repository: string;
  token: string;
  fetch: Fetch;
  apiUrl?: string;
}): Promise<string[]> {
  const api = options.apiUrl ?? 'https://api.github.com';
  const branches: string[] = [];
  for (let page = 1; page <= 10; page++) {
    const response = await options.fetch(
      `${api}/repos/${options.repository}/pulls?state=open&per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${options.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok)
      throw new Error(`GitHub did not list the open pull requests (HTTP ${response.status})`);
    const pulls = (await response.json()) as { head?: { ref?: string } }[];
    for (const pull of pulls)
      if (pull.head?.ref?.startsWith('uptide/')) branches.push(pull.head.ref);
    if (pulls.length < 100) break;
  }
  return branches;
}

/** The pull request number in a GitHub pull request URL. */
export function pullNumber(url: string): number | undefined {
  const n = Number(/\/pull\/(\d+)$/.exec(url)?.[1]);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** A GitHub App slug: lowercase letters, digits and hyphens. */
export const APP_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/;

/**
 * The App's bot account as git should name it, so its commits link to it on GitHub:
 * `<slug>[bot]` and `<bot user id>+<slug>[bot]@users.noreply.github.com`. The id is the bot
 * user's (`GET /users/<slug>[bot]`), not the App's: that is the account GitHub attributes
 * the commit to.
 */
export async function botAuthor(options: {
  slug: string;
  token: string;
  fetch: Fetch;
  apiUrl?: string;
}): Promise<GitAuthor> {
  if (!APP_SLUG.test(options.slug)) throw new Error('the App slug is not a GitHub App slug');
  const login = `${options.slug}[bot]`;
  const api = options.apiUrl ?? 'https://api.github.com';
  const response = await options.fetch(`${api}/users/${encodeURIComponent(login)}`, {
    headers: {
      Authorization: `Bearer ${options.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(`GitHub did not answer for the bot account ${login} (HTTP ${response.status})`);
  const user = (await response.json().catch(() => ({}))) as { id?: unknown; login?: unknown };
  if (!Number.isInteger(user.id) || (user.id as number) <= 0 || user.login !== login)
    throw new Error(`GitHub answered for ${login} without its account id`);
  const host = new URL(api).host === 'api.github.com' ? 'users.noreply.github.com' : undefined;
  // GitHub Enterprise Server has its own noreply domain: the API host without `api.`.
  const noreply = host ?? `users.noreply.${new URL(api).host.replace(/^api\./, '')}`;
  return { name: login, email: `${user.id}+${login}@${noreply}` };
}
