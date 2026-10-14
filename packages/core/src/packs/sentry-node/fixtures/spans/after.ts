import { getClient, init, setupFastifyErrorHandler, spanToJSON } from '@sentry/node';
import fastify from 'fastify';

init({
  dsn: process.env.SENTRY_DSN,
  ignoreTransactions: ['GET /health'], // @uptide ignore-transactions at:ignoreTransactions
  beforeSendTransaction(event) { // @uptide before-send-transaction at:beforeSendTransaction
    return event;
  },
});

export const hasFilters = () => getClient()?.getIntegrationByName('EventFilters') !== undefined; // @uptide integration-names at:'InboundFilters'
export const opOf = (span: Parameters<typeof spanToJSON>[0]) => spanToJSON(span).op; // @uptide span-json-format at:op

const app = fastify();
setupFastifyErrorHandler(app, { shouldHandleError: () => true }); // @uptide error-handler-options at:setupFastifyErrorHandler
