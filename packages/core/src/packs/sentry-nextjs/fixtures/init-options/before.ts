import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.2,
  sendDefaultPii: false, // @uptide send-default-pii at:sendDefaultPii
  // Send logs to Sentry
  enableLogs: true, // @uptide enable-logs at:enableLogs
  _experiments: { enableMetrics: true }, // @uptide enable-metrics at:enableMetrics
  profilesSampleRate: 0.1, // @uptide profiling-options at:profilesSampleRate
  ignoreTransactions: ['/health'], // @uptide ignore-transactions at:ignoreTransactions
  beforeSendTransaction: (event) => event, // @uptide before-send-transaction at:beforeSendTransaction
  skipOpenTelemetrySetup: true, // @uptide opentelemetry-setup at:skipOpenTelemetrySetup
  registerEsmLoaderHooks: false, // @uptide removed-node-options at:registerEsmLoaderHooks
});

// A local helper that happens to be called init is not Sentry's.
function init(options: { enableLogs: boolean; sendDefaultPii: boolean }) {
  return options;
}
init({ enableLogs: true, sendDefaultPii: true }); // @uptide enable-logs keep at:enableLogs
