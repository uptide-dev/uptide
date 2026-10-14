import * as Sentry from '@sentry/node';
import { setupExpressErrorHandler } from '@sentry/node';
import express from 'express';
import Koa from 'koa';

export const options: Sentry.NodeOptions = {
  integrations: [
    Sentry.httpIntegration({
      sessions: false, // @uptide http-integration-options at:trackIncomingRequestsAsSessions
      maxRequestBodySize: 'small', // @uptide http-integration-options at:maxIncomingRequestBodySize
      ignoreRequestBody: (url) => url.includes('/health'), // @uptide http-integration-options at:ignoreIncomingRequestBody
      onSpanCreated: (span) => span.setAttribute('team', 'core'), // @uptide http-integration-options at:incomingRequestSpanHook
      ignoreOutgoingRequests: (url) => url.includes('/metrics'),
    }),
    Sentry.eventFiltersIntegration(), // @uptide renamed-exports at:inboundFiltersIntegration
  ],
};

const app = express();
setupExpressErrorHandler(app); // @uptide error-handlers at:setupExpressErrorHandler

const koa = new Koa();
Sentry.setupKoaErrorHandler(koa); // @uptide error-handlers at:setupKoaErrorHandler

// Not Sentry's error handler: a local one of the same name.
function setupKoaErrorHandler(server: Koa) {
  return server;
}
setupKoaErrorHandler(koa); // @uptide error-handlers keep at:setupKoaErrorHandler
