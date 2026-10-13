import { assertSafeReport } from '../run-report/safe.js';
import type { RunReport } from '../run-report/schema.js';
import { appEndpoint, type Fetch, type Mask, requestIdToken } from './oidc.js';

/**
 * POST the run report to `{app-url}/api/action/results`, with a fresh OIDC token as bearer.
 * The dashboard is secondary to the pull request: any failure is returned as a warning for
 * the log, never thrown, and never quotes what was sent.
 */
export async function postResults(
  report: RunReport,
  options: { appUrl: string; env: NodeJS.ProcessEnv; fetch: Fetch; mask: Mask },
): Promise<{ ok: true } | { ok: false; warning: string }> {
  try {
    // The last gate before the network: a report that could carry code never leaves.
    assertSafeReport(report);
  } catch {
    return { ok: false, warning: 'the run report failed its safety check and was not sent' };
  }
  try {
    const endpoint = appEndpoint(options.appUrl, 'api/action/results');
    const jwt = await requestIdToken(options.env, options.fetch, options.mask);
    const response = await options.fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(report),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok)
      return {
        ok: false,
        warning: `the Uptide app did not accept the run report (HTTP ${response.status}); the dashboard will miss this run`,
      };
    return { ok: true };
  } catch (err) {
    // Our own errors say what failed; anything else is named by its kind only.
    const reason =
      err instanceof Error && err.name === 'ActionAuthError'
        ? err.message
        : err instanceof Error && err.name === 'TimeoutError'
          ? 'timed out'
          : 'network error';
    return {
      ok: false,
      warning: `the run report was not sent to the Uptide app (${reason.split('\n')[0]}); the dashboard will miss this run`,
    };
  }
}
