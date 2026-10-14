import * as Sentry from '@sentry/browser';
import { bfcacheMetricsIntegration, eventFiltersIntegration as filters } from '@sentry/browser'; // @uptide renamed-exports at:bfcacheIntegration
import { report } from './report';

Sentry.init({
  dsn: 'https://public@sentry.example.com/1',
  integrations: [
    Sentry.browserTracingIntegration({
      ignorePerformanceApiSpans: ['third-party-mark'], // @uptide browser-tracing-options at:ignorePerformanceApiSpans
      _experiments: { enableInteractions: true }, // @uptide browser-tracing-options at:_experiments
    }),
    Sentry.breadcrumbsIntegration({ console: false }), // @uptide breadcrumbs-console at:console
    bfcacheMetricsIntegration(), // @uptide renamed-exports at:bfcacheIntegration
    filters(),
  ],
  beforeSendSpan(span) {
    span.data = { ...span.data, team: 'web' }; // @uptide span-json-format at:data
    return span;
  },
});

const client = Sentry.getClient();
export const filtersOn = client?.getIntegrationByName('EventFilters') !== undefined; // @uptide integration-names at:'InboundFilters'

export function feedback(message: string) {
  return Sentry.sendFeedback({ message }).catch((reason) => report(`feedback failed: ${reason}`)); // @uptide feedback-rejection at:reason
}
