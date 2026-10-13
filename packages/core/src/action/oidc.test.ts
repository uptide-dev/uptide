import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { RUN_REPORT_SCHEMA_ID, type RunReport } from '../run-report/schema.js';
import { engineEnv, publishEnv } from './engine.js';
import { botAuthor } from './github.js';
import {
  appEndpoint,
  exchangeToken,
  installationTokens,
  maskWithRunner,
  requestIdToken,
} from './oidc.js';
import { postResults } from './results.js';

// Shapes only: none of these is a real credential.
const JWT = `eyJhbGciOiJSUzI1NiJ9.${'e'.repeat(40)}.${'s'.repeat(40)}`;
const INSTALLATION = `ghs_${'T'.repeat(36)}`;
const RUNNER = `runner-request-${'r'.repeat(20)}`;
const ENV = {
  ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.actions.example/oidc?api-version=2.0',
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: RUNNER,
};

interface Call {
  url: string;
  init: RequestInit | undefined;
}
/** A fetch that answers by URL and records every call. */
function fakeFetch(answers: Record<string, () => Response>) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const path = new URL(url).pathname;
    const answer = answers[path];
    if (!answer) throw new TypeError('fetch failed');
    return answer();
  });
  return { fetch, calls };
}
const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const auth = (call: Call | undefined) => new Headers(call?.init?.headers).get('Authorization');

const oidcAnswer = { '/oidc': () => ok({ value: JWT }) };
const exchangeAnswer = {
  '/api/action/token': () => ok({ token: INSTALLATION, expiresAt: '2026-10-13T07:17:00Z' }),
};

describe('the OIDC token', () => {
  it('is requested with audience uptide and the runner bearer, and masked', async () => {
    const { fetch, calls } = fakeFetch(oidcAnswer);
    const masked: string[] = [];
    expect(await requestIdToken(ENV, fetch, (s) => masked.push(s))).toBe(JWT);
    const url = new URL(calls[0]?.url ?? '');
    expect(url.searchParams.get('audience')).toBe('uptide');
    expect(url.searchParams.get('api-version')).toBe('2.0');
    expect(auth(calls[0])).toBe(`Bearer ${RUNNER}`);
    expect(masked).toEqual([JWT]);
  });

  it('says what the workflow lacks when GitHub issued none', async () => {
    const { fetch } = fakeFetch(oidcAnswer);
    await expect(requestIdToken({}, fetch, () => {})).rejects.toThrow('id-token: write');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('the token exchange', () => {
  it('posts the OIDC token as bearer and masks the installation token first', async () => {
    const { fetch, calls } = fakeFetch(exchangeAnswer);
    const order: string[] = [];
    const result = await exchangeToken('https://app.example', JWT, fetch, (s) => order.push(s));
    expect(result.token).toBe(INSTALLATION);
    expect(result.expiresAt.toISOString()).toBe('2026-10-13T07:17:00.000Z');
    expect(calls[0]?.url).toBe('https://app.example/api/action/token');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(auth(calls[0])).toBe(`Bearer ${JWT}`);
    expect(order).toEqual([INSTALLATION]);
  });

  it('keeps a path on app-url, and refuses plain HTTP and credentials in it', () => {
    expect(appEndpoint('https://uptide.example/base', 'api/action/token')).toBe(
      'https://uptide.example/base/api/action/token',
    );
    expect(appEndpoint('http://localhost:3000', 'api/action/token')).toBe(
      'http://localhost:3000/api/action/token',
    );
    expect(() => appEndpoint('http://uptide.example', 'x')).toThrow('https://');
    expect(() => appEndpoint('https://user:pw@uptide.example', 'x')).toThrow('without credentials');
  });

  it('fails with a reason, and never with a token in the message', async () => {
    const cases: [Record<string, () => Response>, string][] = [
      [
        { '/api/action/token': () => ok({ error: 'no installation' }, 404) },
        'install the Uptide GitHub App',
      ],
      [
        { '/api/action/token': () => ok({ message: JWT }, 500) },
        'refused the token exchange (HTTP 500)',
      ],
      [{ '/api/action/token': () => ok({ token: INSTALLATION }) }, 'without { token, expiresAt }'],
      [{}, 'could not reach the Uptide app at https://app.example'],
    ];
    for (const [answers, reason] of cases) {
      const { fetch } = fakeFetch(answers);
      const masked: string[] = [];
      const err = await exchangeToken('https://app.example', JWT, fetch, (s) =>
        masked.push(s),
      ).catch((e: Error) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain(reason);
      expect((err as Error).message).not.toContain(JWT);
      expect((err as Error).message).not.toContain(INSTALLATION);
    }
  });

  it('masks a token that arrives with a refusal too', async () => {
    const { fetch } = fakeFetch({ '/api/action/token': () => ok({ token: INSTALLATION }, 500) });
    const masked: string[] = [];
    await exchangeToken('https://app.example', JWT, fetch, (s) => masked.push(s)).catch(() => {});
    expect(masked).toEqual([INSTALLATION]);
  });

  it('is exchanged on first use, reused, and renewed before it expires', async () => {
    let n = 0;
    const { fetch } = fakeFetch({
      ...oidcAnswer,
      '/api/action/token': () =>
        ok({
          token: `${INSTALLATION}${++n}`,
          expiresAt: new Date(Date.UTC(2026, 9, 13, 7)).toISOString(),
        }),
    });
    let now = Date.UTC(2026, 9, 13, 6);
    const tokens = installationTokens({
      appUrl: 'https://app.example',
      env: ENV,
      fetch,
      mask: () => {},
      now: () => now,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(await tokens.get()).toBe(`${INSTALLATION}1`);
    expect(await tokens.get()).toBe(`${INSTALLATION}1`);
    now = Date.UTC(2026, 9, 13, 6, 56); // four minutes left: renewed
    expect(await tokens.get()).toBe(`${INSTALLATION}2`);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('masks with the runner command, line by line', () => {
    const out: string[] = [];
    maskWithRunner((t) => out.push(t))(INSTALLATION);
    expect(out).toEqual([`::add-mask::${INSTALLATION}\n`]);
  });
});

describe('the results upload', () => {
  const report: RunReport = {
    schema: RUN_REPORT_SCHEMA_ID,
    engineVersion: '0.9.0',
    repo: { id: 1, owner: 'acme', name: 'shop' },
    sha: 'b'.repeat(40),
    runId: 2,
    runAttempt: 1,
    mode: 'check',
    startedAt: '2026-10-13T06:00:00.000Z',
    finishedAt: '2026-10-13T06:01:00.000Z',
    upgrades: [],
  };

  it('posts the report with a fresh OIDC bearer', async () => {
    const { fetch, calls } = fakeFetch({ ...oidcAnswer, '/api/action/results': () => ok({}, 202) });
    expect(
      await postResults(report, { appUrl: 'https://app.example', env: ENV, fetch, mask: () => {} }),
    ).toEqual({ ok: true });
    const post = calls.find((c) => c.url.endsWith('/api/action/results'));
    expect(auth(post)).toBe(`Bearer ${JWT}`);
    expect(JSON.parse(String(post?.init?.body))).toEqual(report);
  });

  it('warns instead of failing: app down, app refusing, no OIDC', async () => {
    for (const [answers, env, warning] of [
      [{ ...oidcAnswer }, ENV, 'network error'],
      [{ ...oidcAnswer, '/api/action/results': () => ok({}, 500) }, ENV, 'HTTP 500'],
      [{}, {}, 'id-token: write'],
    ] as const) {
      const { fetch } = fakeFetch(answers);
      const result = await postResults(report, {
        appUrl: 'https://app.example',
        env,
        fetch,
        mask: () => {},
      });
      expect(result.ok).toBe(false);
      expect(!result.ok && result.warning).toContain(warning);
    }
  });

  it('never sends a report that fails its safety check', async () => {
    const { fetch } = fakeFetch({ ...oidcAnswer, '/api/action/results': () => ok({}) });
    const unsafe = { ...report, error: 'line one\nconst secret = 1' };
    const result = await postResults(unsafe, {
      appUrl: 'https://app.example',
      env: ENV,
      fetch,
      mask: () => {},
    });
    expect(result).toEqual({
      ok: false,
      warning: 'the run report failed its safety check and was not sent',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('the engine environment', () => {
  it('drops every credential and the runner token endpoints, keeping what is passed on purpose', () => {
    const env = engineEnv(
      {
        PATH: '/usr/bin',
        GITHUB_TOKEN: 'x',
        GH_TOKEN: 'x',
        NPM_TOKEN: 'x',
        ANTHROPIC_API_KEY: 'x',
        AWS_SECRET_ACCESS_KEY: 'x',
        ACTIONS_ID_TOKEN_REQUEST_URL: 'x',
        ACTIONS_RUNTIME_URL: 'x',
        UPTIDE_ANTHROPIC_API_KEY: 'x',
        GITHUB_REPOSITORY: 'acme/shop',
      },
      { ANTHROPIC_API_KEY: 'kept' },
    );
    expect(env.PATH).toBe('/usr/bin');
    expect(env.GITHUB_REPOSITORY).toBe('acme/shop');
    expect(env.ANTHROPIC_API_KEY).toBe('kept');
    for (const gone of [
      'GITHUB_TOKEN',
      'GH_TOKEN',
      'NPM_TOKEN',
      'AWS_SECRET_ACCESS_KEY',
      'ACTIONS_ID_TOKEN_REQUEST_URL',
      'ACTIONS_RUNTIME_URL',
      'UPTIDE_ANTHROPIC_API_KEY',
    ])
      expect(env[gone], gone).toBeUndefined();
    expect(env.GIT_AUTHOR_NAME).toBe('uptide[bot]');
  });

  it('gives uptide pr the token through a private gh config and a git header, then removes it', () => {
    const { env, cleanup } = publishEnv(
      { RUNNER_TEMP: undefined, GITHUB_TOKEN: 'x' },
      INSTALLATION,
    );
    const hosts = `${env.GH_CONFIG_DIR}/hosts.yml`;
    expect(readFileSync(hosts, 'utf8')).toContain(`github.com:\n    oauth_token: ${INSTALLATION}`);
    expect(statSync(hosts).mode & 0o777).toBe(0o600);
    expect(env.GIT_CONFIG_KEY_0).toBe('http.https://github.com/.extraheader');
    expect(env.GIT_CONFIG_VALUE_0).toMatch(/^AUTHORIZATION: basic /);
    // In no variable name the engine's subprocess filter would keep it out of: on purpose.
    for (const [key, value] of Object.entries(env))
      if (value?.includes(INSTALLATION)) expect(key).toBe('never');
    expect(env.GITHUB_TOKEN).toBeUndefined();
    cleanup();
    expect(existsSync(hosts)).toBe(false);
  });
});

describe('the commit author', () => {
  const BOT = { login: 'uptide-app[bot]', id: 241_557_013, type: 'Bot' };

  it("is the App's bot account: <bot user id>+<slug>[bot]@users.noreply.github.com", async () => {
    const { fetch, calls } = fakeFetch({ '/users/uptide-app%5Bbot%5D': () => ok(BOT) });
    expect(await botAuthor({ slug: 'uptide-app', token: INSTALLATION, fetch })).toEqual({
      name: 'uptide-app[bot]',
      email: '241557013+uptide-app[bot]@users.noreply.github.com',
    });
    expect(calls[0]?.url).toBe('https://api.github.com/users/uptide-app%5Bbot%5D');
    expect(auth(calls[0])).toBe(`Bearer ${INSTALLATION}`);
    // GitHub Enterprise Server: its own API and noreply domain.
    const ghes = fakeFetch({ '/api/v3/users/uptide-app%5Bbot%5D': () => ok(BOT) });
    expect(
      (
        await botAuthor({
          slug: 'uptide-app',
          token: INSTALLATION,
          fetch: ghes.fetch,
          apiUrl: 'https://ghe.example.com/api/v3',
        })
      ).email,
    ).toBe('241557013+uptide-app[bot]@users.noreply.ghe.example.com');
  });

  it('refuses an answer that is not the bot account, and a slug that is not one', async () => {
    const wrong = fakeFetch({
      '/users/uptide-app%5Bbot%5D': () => ok({ ...BOT, login: 'someone' }),
    });
    await expect(
      botAuthor({ slug: 'uptide-app', token: INSTALLATION, fetch: wrong.fetch }),
    ).rejects.toThrow('without its account id');
    const missing = fakeFetch({ '/users/uptide-app%5Bbot%5D': () => ok({}, 404) });
    await expect(
      botAuthor({ slug: 'uptide-app', token: INSTALLATION, fetch: missing.fetch }),
    ).rejects.toThrow('HTTP 404');
    await expect(
      botAuthor({ slug: '../evil', token: INSTALLATION, fetch: missing.fetch }),
    ).rejects.toThrow('not a GitHub App slug');
  });

  it('takes the App slug from the token exchange, when the Uptide app names it', async () => {
    const named = fakeFetch({
      ...oidcAnswer,
      '/api/action/token': () =>
        ok({ token: INSTALLATION, expiresAt: '2099-01-01T00:00:00Z', app: { slug: 'uptide-app' } }),
    });
    const tokens = installationTokens({
      appUrl: 'https://app.example',
      env: ENV,
      fetch: named.fetch,
      mask: () => {},
    });
    expect(tokens.appSlug()).toBeUndefined();
    await tokens.get();
    expect(tokens.appSlug()).toBe('uptide-app');
    const bad = fakeFetch({
      '/api/action/token': () =>
        ok({ token: INSTALLATION, expiresAt: '2099-01-01T00:00:00Z', app: { slug: 'a b' } }),
    });
    expect((await exchangeToken('https://app.example', JWT, bad.fetch, () => {})).app).toBe(
      undefined,
    );
  });

  it('is what git records for the engine and for uptide pr', () => {
    const author = { name: 'uptide-app[bot]', email: '1+uptide-app[bot]@users.noreply.github.com' };
    const env = engineEnv({}, {}, author);
    expect([env.GIT_AUTHOR_NAME, env.GIT_COMMITTER_NAME]).toEqual([author.name, author.name]);
    expect([env.GIT_AUTHOR_EMAIL, env.GIT_COMMITTER_EMAIL]).toEqual([author.email, author.email]);
    const { env: publish, cleanup } = publishEnv({}, INSTALLATION, undefined, author);
    expect(publish.GIT_AUTHOR_EMAIL).toBe(author.email);
    cleanup();
  });
});
