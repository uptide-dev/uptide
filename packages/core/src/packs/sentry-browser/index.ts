import { sentryPack } from '../sentry/pack.js';

/** @sentry/browser 10 → 11: the shared Sentry pack led by the package this repository declares. */
export const sentryBrowserPack = sentryPack('@sentry/browser');
