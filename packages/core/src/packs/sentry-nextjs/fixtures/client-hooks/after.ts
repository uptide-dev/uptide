import * as Sentry from '@sentry/nextjs';
import { eventFiltersIntegration } from '@sentry/nextjs'; // @uptide renamed-exports at:inboundFiltersIntegration
import { toast } from './toast';

// Declared apart from Sentry.init, typed any: the compiler cannot see the v10 fields.
function scrub(span: any) {
  if (span.op === 'db.query') span.description = '[filtered]'; // @uptide span-json-format at:op
  return span;
}

Sentry.init({
  dsn: 'https://public@sentry.example.com/1',
  integrations: (defaults) => [
    ...defaults.filter((integration) => integration.name !== 'EventFilters'), // @uptide integration-names at:'InboundFilters'
    eventFiltersIntegration({ ignoreErrors: [/ResizeObserver/] }), // @uptide renamed-exports at:inboundFiltersIntegration
    Sentry.browserTracingIntegration({ trackFetchStreamPerformance: true }), // @uptide browser-tracing-options at:trackFetchStreamPerformance
    Sentry.breadcrumbsIntegration({ console: false }), // @uptide breadcrumbs-console at:console
  ],
  beforeSendSpan: scrub,
});

export const op = (span: Parameters<typeof Sentry.spanToJSON>[0]) => Sentry.spanToJSON(span).op; // @uptide span-json-format at:op
// `name` is in both formats: left alone.
export const name = (span: Parameters<typeof Sentry.spanToJSON>[0]) => Sentry.spanToJSON(span).name; // @uptide span-json-format keep at:name

export async function sendFeedback(message: string) {
  try {
    await Sentry.sendFeedback({ message });
  } catch (error) {
    if (typeof error === 'string') toast(error); // @uptide feedback-rejection at:typeof
    else toast((error as Error).message);
  }
}
