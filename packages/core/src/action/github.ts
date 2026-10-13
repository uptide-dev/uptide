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
