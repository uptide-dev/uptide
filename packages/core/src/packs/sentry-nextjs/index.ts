import { sentryPack } from '../sentry/pack.js';

/** @sentry/nextjs 10 → 11: the shared Sentry pack led by the package this repository declares. */
export const sentryNextjsPack = sentryPack('@sentry/nextjs');
