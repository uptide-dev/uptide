import * as Sentry from '@sentry/node';
import type { Event } from '@sentry/types'; // @uptide removed-modules at:import
import { nodeProfilingIntegration } from '@sentry/profiling-node';

const processors = [];

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  integrations: [nodeProfilingIntegration()],
  tracesSampleRate: 1.0,
  profilesSampler: () => 0.5, // @uptide profiling-options at:profilesSampler
  sendDefaultPii: true, // @uptide send-default-pii at:sendDefaultPii
  enableLogs: true, // @uptide enable-logs at:enableLogs
  enableMetrics: true, // @uptide enable-metrics at:enableMetrics
  openTelemetrySpanProcessors: processors, // @uptide opentelemetry-setup at:openTelemetrySpanProcessors
  disableInstrumentationWarnings: true, // @uptide removed-node-options at:disableInstrumentationWarnings
  beforeSendSpan: Sentry.withStreamedSpan((span) => span), // @uptide streamed-span-wrapper at:withStreamedSpan
  beforeSend(event: Event) {
    return event;
  },
});

// Options built for something else that only share a name.
export const queue = { enableLogs: true, sendDefaultPii: false }; // @uptide enable-logs keep at:enableLogs
