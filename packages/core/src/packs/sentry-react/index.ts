import { sentryPack } from '../sentry/pack.js';

/**
 * @sentry/react 10 → 11: the shared Sentry pack led by the package this repository declares.
 * Not registered yet: its ground truth is reviewed and its fixtures pass, but two engine gaps
 * keep it from the gate (../sentry/RESEARCH.md, "What the engine could not express").
 */
export const sentryReactPack = sentryPack('@sentry/react');
