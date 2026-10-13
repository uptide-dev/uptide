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

/** Who Uptide's commits are authored and committed by. */
export interface CommitIdentity {
  name: string;
  email: string;
}

/** What commits fall back to when the App's bot cannot be resolved: no GitHub account. */
export const FALLBACK_IDENTITY: CommitIdentity = {
  name: 'uptide[bot]',
  email: 'uptide@users.noreply.github.com',
};

/** A GitHub App slug: lowercase letters, digits and hyphens. */
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/;

/**
 * The App's own bot account, so its commits are linked to it: `<slug>[bot]`, with the noreply
 * address GitHub gives the bot user (`<id>+<slug>[bot]@users.noreply.github.com`). The slug is
 * the one the Uptide app named in the token exchange, else `GET /app` with the installation
 * token, when GitHub answers that; the id is the bot user's (`GET /users/<slug>[bot]`).
 * Undefined when either cannot be had: the caller keeps the fallback and says so.
 */
export async function appBotIdentity(options: {
  token: string;
  fetch: Fetch;
  appSlug?: string;
  apiUrl?: string;
}): Promise<CommitIdentity | undefined> {
  const api = options.apiUrl ?? 'https://api.github.com';
  const get = async (path: string): Promise<Record<string, unknown> | undefined> => {
    try {
      const response = await options.fetch(`${api}${path}`, {
        headers: {
          Authorization: `Bearer ${options.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(30_000),
      });
      return response.ok ? ((await response.json()) as Record<string, unknown>) : undefined;
    } catch {
      return undefined;
    }
  };
  let slug = options.appSlug;
  if (slug === undefined || !SLUG.test(slug)) {
    const app = await get('/app');
    slug = typeof app?.slug === 'string' ? app.slug : undefined;
  }
  if (slug === undefined || !SLUG.test(slug)) return undefined;
  const login = `${slug}[bot]`;
  const user = await get(`/users/${encodeURIComponent(login)}`);
  const id = user?.id;
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0 || user?.login !== login)
    return undefined;
  return { name: login, email: `${id}+${login}@users.noreply.github.com` };
}
