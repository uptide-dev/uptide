/**
 * The Action's identity, and the token it pushes and opens pull requests with.
 *
 * GitHub issues this job an OIDC token (audience `uptide`) when the workflow grants
 * `id-token: write`. The Uptide app verifies it and answers with a short-lived installation
 * token of the Uptide GitHub App for this repository. Pull requests opened with it run the
 * repository's CI, which pull requests opened with `GITHUB_TOKEN` never do.
 *
 * Neither token is ever printed, logged or put in an error message: the installation token
 * is masked the moment it arrives, and failures say what failed, not what was sent.
 */

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
/** Registers a secret with the runner so it is replaced by *** in every later log line. */
export type Mask = (secret: string) => void;

export const OIDC_AUDIENCE = 'uptide';
const TIMEOUT_MS = 30_000;
/** Refresh an installation token this long before it expires: a push must not race it. */
const REFRESH_MARGIN_MS = 5 * 60_000;

export class ActionAuthError extends Error {
  override readonly name = 'ActionAuthError';
}

/** `::add-mask::`, the runner's own command; it never echoes the value it masks. */
export const maskWithRunner =
  (write: (text: string) => void): Mask =>
  (secret) => {
    for (const line of secret.split(/\r?\n/)) if (line) write(`::add-mask::${line}\n`);
  };

/**
 * An endpoint of the Uptide app. HTTPS only (plain HTTP to localhost for tests): an OIDC
 * token proves this repository's identity and must never cross the network in the clear.
 */
export function appEndpoint(appUrl: string, path: string): string {
  let url: URL;
  try {
    url = new URL(appUrl);
  } catch {
    throw new ActionAuthError('app-url is not a URL');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
    url.username ||
    url.password
  )
    throw new ActionAuthError('app-url must be an https:// URL without credentials');
  return new URL(path, url.href.endsWith('/') ? url.href : `${url.href}/`).href;
}

/** A fresh OIDC token for this job, as `core.getIDToken(audience)` gets it. */
export async function requestIdToken(
  env: NodeJS.ProcessEnv,
  fetchImpl: Fetch,
  mask: Mask,
  audience = OIDC_AUDIENCE,
): Promise<string> {
  const requestUrl = env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!requestUrl || !requestToken)
    throw new ActionAuthError(
      'GitHub issued no OIDC token to this job: the workflow needs `permissions: id-token: write`',
    );
  const url = new URL(requestUrl);
  url.searchParams.set('audience', audience);
  const response = await fetchImpl(url.href, {
    headers: { Authorization: `Bearer ${requestToken}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => {
    throw new ActionAuthError('could not reach GitHub for an OIDC token');
  });
  if (!response.ok)
    throw new ActionAuthError(`GitHub refused an OIDC token (HTTP ${response.status})`);
  const value = ((await response.json().catch(() => ({}))) as { value?: unknown }).value;
  if (typeof value !== 'string' || !value)
    throw new ActionAuthError('GitHub answered without an OIDC token');
  mask(value);
  return value;
}

export interface InstallationToken {
  token: string;
  expiresAt: Date;
}

/** POST the OIDC token to `{app-url}/api/action/token`; the installation token comes back. */
export async function exchangeToken(
  appUrl: string,
  jwt: string,
  fetchImpl: Fetch,
  mask: Mask,
): Promise<InstallationToken> {
  const endpoint = appEndpoint(appUrl, 'api/action/token');
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => {
    throw new ActionAuthError(`could not reach the Uptide app at ${new URL(endpoint).origin}`);
  });
  const body = (await response.json().catch(() => ({}))) as {
    token?: unknown;
    expiresAt?: unknown;
  };
  // Masked before anything else happens with the answer, even a refusal that carries one.
  if (typeof body.token === 'string' && body.token) mask(body.token);
  if (!response.ok)
    throw new ActionAuthError(
      response.status === 404 || response.status === 403
        ? `the Uptide app has no installation for this repository (HTTP ${response.status}): install the Uptide GitHub App on it`
        : `the Uptide app refused the token exchange (HTTP ${response.status})`,
    );
  const expiresAt = typeof body.expiresAt === 'string' ? new Date(body.expiresAt) : undefined;
  if (typeof body.token !== 'string' || !body.token || !expiresAt || Number.isNaN(+expiresAt))
    throw new ActionAuthError(
      'the Uptide app answered the token exchange without { token, expiresAt }',
    );
  return { token: body.token, expiresAt };
}

/**
 * The installation token, exchanged on first use and again shortly before it expires. A run
 * that never pushes never asks for one.
 */
export function installationTokens(options: {
  appUrl: string;
  env: NodeJS.ProcessEnv;
  fetch: Fetch;
  mask: Mask;
  now?: () => number;
}): { get(): Promise<string> } {
  const now = options.now ?? Date.now;
  let current: InstallationToken | undefined;
  return {
    async get() {
      if (!current || current.expiresAt.getTime() - now() < REFRESH_MARGIN_MS) {
        const jwt = await requestIdToken(options.env, options.fetch, options.mask);
        current = await exchangeToken(options.appUrl, jwt, options.fetch, options.mask);
      }
      return current.token;
    },
  };
}
