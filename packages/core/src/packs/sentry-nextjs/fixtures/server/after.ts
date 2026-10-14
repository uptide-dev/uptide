import * as Sentry from '@sentry/nextjs';
import type { Integration } from '@sentry/types'; // @uptide removed-modules at:import

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      integrations: (defaults: Integration[]) => [
        ...defaults,
        Sentry.httpIntegration({ maxRequestBodySize: 'medium' }), // @uptide http-integration-options at:maxIncomingRequestBodySize
      ],
      beforeSendSpan: (span) => span, // @uptide streamed-span-wrapper at:withStreamedSpan
    });
  }
}

export function attach(app: Parameters<typeof Sentry.setupExpressErrorHandler>[0]) {
  Sentry.setupExpressErrorHandler(app); // @uptide error-handlers at:setupExpressErrorHandler
}

export function attachFiltered(app: Parameters<typeof Sentry.setupExpressErrorHandler>[0]) {
  Sentry.setupExpressErrorHandler(app, { shouldHandleError: () => true }); // @uptide error-handler-options at:setupExpressErrorHandler
}
