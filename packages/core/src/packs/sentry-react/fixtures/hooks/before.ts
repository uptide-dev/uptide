import * as Sentry from '@sentry/react';
import type { Event } from '@sentry/types'; // @uptide removed-modules at:import

Sentry.init({
  dsn: 'https://public@sentry.example.com/1',
  beforeSendTransaction: (event: Event) => event, // @uptide before-send-transaction at:beforeSendTransaction
  beforeSendSpan: Sentry.withStreamedSpan((span) => span), // @uptide streamed-span-wrapper at:withStreamedSpan
});
