import { describe, expect, it, vi } from 'vitest';
import { appBotIdentity } from './github.js';

// Shapes only: not a real credential.
const INSTALLATION = `ghs_${'T'.repeat(36)}`;
const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** GitHub's API as the installation token sees it: by path, every call recorded. */
function api(answers: Record<string, () => Response>) {
  const calls: { url: string; auth: string | null }[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, auth: new Headers(init?.headers).get('Authorization') });
    const answer = answers[decodeURIComponent(new URL(url).pathname)];
    if (!answer) throw new TypeError('fetch failed');
    return answer();
  });
  return { fetch, calls };
}
const bot = {
  '/users/uptide-app[bot]': () => ok({ login: 'uptide-app[bot]', id: 1234, type: 'Bot' }),
};

describe("the App's bot identity", () => {
  it('is the bot user of the slug the Uptide app named, with its noreply address', async () => {
    const { fetch, calls } = api(bot);
    expect(await appBotIdentity({ token: INSTALLATION, fetch, appSlug: 'uptide-app' })).toEqual({
      name: 'uptide-app[bot]',
      email: '1234+uptide-app[bot]@users.noreply.github.com',
    });
    expect(calls.map((c) => c.url)).toEqual(['https://api.github.com/users/uptide-app%5Bbot%5D']);
    expect(calls[0]?.auth).toBe(`Bearer ${INSTALLATION}`);
  });

  it('asks GET /app for the slug when the Uptide app named none, on the API it is given', async () => {
    const { fetch, calls } = api({
      '/api/v3/app': () => ok({ slug: 'uptide-app' }),
      ...prefixed(bot),
    });
    expect(
      await appBotIdentity({ token: INSTALLATION, fetch, apiUrl: 'https://ghe.example/api/v3' }),
    ).toMatchObject({ name: 'uptide-app[bot]' });
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
      '/api/v3/app',
      '/api/v3/users/uptide-app%5Bbot%5D',
    ]);
  });

  it('is undefined when the slug or the bot user cannot be had, or does not match', async () => {
    const cases: [Record<string, () => Response>, string | undefined][] = [
      // GitHub refuses GET /app to an installation token, and no slug was named.
      [{ '/app': () => ok({ message: 'A JSON web token could not be decoded' }, 401) }, undefined],
      // A slug that is not one: never put in a URL.
      [bot, 'Uptide App/../x'],
      // No such user, the network down, or another account answering.
      [{ '/users/uptide-app[bot]': () => ok({ message: 'Not Found' }, 404) }, 'uptide-app'],
      [{}, 'uptide-app'],
      [{ '/users/uptide-app[bot]': () => ok({ login: 'someone-else', id: 1 }) }, 'uptide-app'],
      [
        { '/users/uptide-app[bot]': () => ok({ login: 'uptide-app[bot]', id: '1234' }) },
        'uptide-app',
      ],
    ];
    for (const [answers, appSlug] of cases) {
      const { fetch } = api(answers);
      expect(
        await appBotIdentity({ token: INSTALLATION, fetch, ...(appSlug ? { appSlug } : {}) }),
      ).toBeUndefined();
    }
  });
});

function prefixed(answers: Record<string, () => Response>): Record<string, () => Response> {
  return Object.fromEntries(
    Object.entries(answers).map(([path, answer]) => [`/api/v3${path}`, answer]),
  );
}
