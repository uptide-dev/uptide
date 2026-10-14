import type { Event } from '@sentry/core'; // @uptide removed-modules keep at:import
import * as Sentry from '@sentry/browser';
import * as Other from 'other-sdk';
import { init as initQueue } from './queue';

// Options of other libraries, shaped like Sentry's, are not sites.
initQueue({ sendDefaultPii: true }); // @uptide send-default-pii keep at:sendDefaultPii
Other.init({ enableLogs: true }); // @uptide enable-logs keep at:enableLogs
Other.init({ enableMetrics: true }); // @uptide enable-metrics keep at:enableMetrics
Other.init({ profilesSampleRate: 1 }); // @uptide profiling-options keep at:profilesSampleRate
Other.init({ ignoreTransactions: [] }); // @uptide ignore-transactions keep at:ignoreTransactions
Other.init({ beforeSendTransaction: (event: Event) => event }); // @uptide before-send-transaction keep at:beforeSendTransaction
Other.browserTracingIntegration({ trackFetchStreamPerformance: true }); // @uptide browser-tracing-options keep at:trackFetchStreamPerformance
Other.breadcrumbsIntegration({ console: false }); // @uptide breadcrumbs-console keep at:console
export const wrapped = Other.withStreamedSpan((span: unknown) => span); // @uptide streamed-span-wrapper keep at:withStreamedSpan

// A local of an old export's name is not Sentry's.
const inboundFiltersIntegration = () => Sentry.eventFiltersIntegration(); // @uptide renamed-exports keep at:inboundFiltersIntegration
export const filters = [inboundFiltersIntegration()];
// The same string, compared with something that is not an integration's name.
export const isStep = (step: { label: string }) => step.label === 'InboundFilters'; // @uptide integration-names keep at:'InboundFilters'
// Spans of another tracer.
export const opOf = (span: { op: string }) => span.op; // @uptide span-json-format keep at:op
// A sendFeedback that is not Sentry's.
export async function send(o: { sendFeedback(message: string): Promise<void> }) {
  try {
    await o.sendFeedback('hi');
  } catch (error) {
    return `failed: ${error}`; // @uptide feedback-rejection keep at:error
  }
}
