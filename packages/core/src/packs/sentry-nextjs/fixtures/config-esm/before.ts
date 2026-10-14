import { withSentryConfig } from '@sentry/nextjs'; // @uptide with-sentry-config-import at:withSentryConfig
import { withHelpers } from './helpers.mjs';

const nextConfig = { reactStrictMode: true };

export default withSentryConfig(withHelpers(nextConfig), {
  org: 'acme',
  project: 'web',
  disableLogger: true, // @uptide build-options at:disableLogger
  webpack: {
    autoInstrumentMiddleware: false,
  },
  automaticVercelMonitors: true, // @uptide build-options at:automaticVercelMonitors
  reactComponentAnnotation: { enabled: true },
});

// Not Sentry's build options: left alone.
export const other = { disableLogger: true }; // @uptide build-options keep at:disableLogger
