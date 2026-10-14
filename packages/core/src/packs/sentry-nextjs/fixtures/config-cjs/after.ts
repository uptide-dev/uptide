// @ts-check
const { withSentryConfig } = require('@sentry/nextjs/config'); // @uptide with-sentry-config-import at:withSentryConfig
const { i18n } = require('./next-i18next.config');

const sentryOptions = {
  silent: true,
  webpack: {
    // Tree-shake Sentry logger statements to reduce bundle size
    treeshake: { removeDebugLogging: true },
    disableSentryConfig: false }, // @uptide build-options at:disableSentryWebpackConfig
};

module.exports = withSentryConfig({ i18n }, sentryOptions);

// A helper of the same name from another module is not Sentry's.
const local = { withSentryConfig: require('./wrap').withSentryConfig }; // @uptide with-sentry-config-import keep at:withSentryConfig
