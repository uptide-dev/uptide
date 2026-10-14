import { withSentryConfig } from '@sentry/nextjs/config'; // @uptide with-sentry-config-import at:withSentryConfig
import { withHelpers } from './helpers.mjs';

const nextConfig = { reactStrictMode: true };

export default withSentryConfig(withHelpers(nextConfig), {
  org: 'acme',
  project: 'web',
  webpack: {
    treeshake: { removeDebugLogging: true },
    automaticVercelMonitors: true,
    autoInstrumentMiddleware: false,
  },
  reactComponentAnnotation: { enabled: true },
});

// Not Sentry's build options: left alone.
export const other = { disableLogger: true }; // @uptide build-options keep at:disableLogger
