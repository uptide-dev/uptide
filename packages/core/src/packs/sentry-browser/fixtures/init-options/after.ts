import * as Sentry from '@sentry/browser';

export function buildOptions(dsn: string): Sentry.BrowserOptions {
  return {
    dsn,
    sendDefaultPii: false, // @uptide send-default-pii at:sendDefaultPii
    profilesSampleRate: 0.1, // @uptide profiling-options at:profilesSampleRate
    ignoreTransactions: [/healthz/], // @uptide ignore-transactions at:ignoreTransactions
  };
}

export function initSentry(config: Sentry.BrowserOptions) {
  Sentry.init({ ...config }); // @uptide enable-metrics at:enableMetrics
}

// Settings of another tool, shaped alike.
export const analytics = { sendDefaultPii: false, enableLogs: true }; // @uptide send-default-pii keep at:sendDefaultPii
