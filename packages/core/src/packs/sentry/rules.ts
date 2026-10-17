import type { PackRule } from '../contract.js';
import {
  BUILD_OPTIONS,
  buildOptionSites,
  callSites,
  configImportSites,
  feedbackRejectionSites,
  initOptionSites,
  integrationNameSites,
  integrationOptionSites,
  moveBuildOption,
  moveConfigImport,
  passesHandlerOptions,
  preloadSites,
  removeDefaultedOption,
  removedModuleSites,
  renamedExportSites,
  renameExport,
  renameIntegrationName,
  renameIntegrationOption,
  spanJsonSites,
  unwrapStreamedSpan,
} from './detect.js';
import { GUIDE } from './meta.js';

/** The SDKs a rule applies to, by the package a consumer declares. */
export type Lead = '@sentry/nextjs' | '@sentry/node' | '@sentry/react' | '@sentry/browser';
const ALL: readonly Lead[] = ['@sentry/nextjs', '@sentry/node', '@sentry/react', '@sentry/browser'];
const SERVER: readonly Lead[] = ['@sentry/nextjs', '@sentry/node'];
const BROWSER: readonly Lead[] = ['@sentry/nextjs', '@sentry/react', '@sentry/browser'];

export interface SentryRule extends PackRule {
  leads: readonly Lead[];
}

const anchor = (section: string) => `${GUIDE.replace(/#.*$/, '')}#${section}`;
/** What every guide with options ends with: the choice is the owner's, and the PR says it. */
const CHOOSE =
  'Pick the option closest to what the code did on v10 and record which one you chose, why, and the alternatives in decisions; never pick the more permissive one silently.';

/**
 * A compiler finding about one of these names: an option an object literal may no longer
 * specify (TS2353, TS2561 "did you mean"), a member that no longer exists (TS2339, TS2551),
 * or a removed export (TS2305, TS2724, TS2614). An empty message is a type-diff finding.
 */
function named(names: readonly string[]): RegExp {
  return new RegExp(`(?:^$|'(?:${names.join('|')})')`);
}
function symbols(names: readonly string[]): RegExp {
  return new RegExp(
    `(?:(?:^|[#.:])(?:${names.join('|')})$|^TS(?:2353|2561|2339|2551|2305|2724|2614|6385|6387)$)`,
  );
}

const INIT_KINDS = ['removed', 'type', 'signature', 'deprecated'] as const;

const OTEL_OPTIONS = [
  'skipOpenTelemetrySetup',
  'openTelemetrySpanProcessors',
  'openTelemetryInstrumentations',
  'openTelemetryBasicTracerProvider',
];
const NODE_OPTIONS = [
  'registerEsmLoaderHooks',
  'disableInstrumentationWarnings',
  'maxSpanWaitDuration',
];
const HTTP_OPTIONS: Record<string, true> = {
  trackIncomingRequestsAsSessions: true,
  maxIncomingRequestBodySize: true,
  ignoreIncomingRequestBody: true,
  dropSpansForIncomingRequestStatusCodes: true,
  incomingRequestSpanHook: true,
  instrumentation: true,
};
const ERROR_HANDLERS = [
  'setupExpressErrorHandler',
  'expressErrorHandler',
  'setupFastifyErrorHandler',
  'setupKoaErrorHandler',
  'setupHapiErrorHandler',
];
const BROWSER_TRACING_OPTIONS = [
  'trackFetchStreamPerformance',
  'ignorePerformanceApiSpans',
  '_experiments',
  'beforeSpanEnd',
];
const REMOVED = [
  'clear',
  'SEMANTIC_ATTRIBUTE_SENTRY_SOURCE',
  'createSpanEnvelope',
  'SentryContextManager',
  'generateInstrumentOnce',
  'preloadOpenTelemetry',
  'validateOpenTelemetrySetup',
  'setNodeAsyncContextStrategy',
  'honoIntegration',
  'setupHonoErrorHandler',
  'connectIntegration',
  'setupConnectErrorHandler',
  'instrumentFastify',
  'handleFastifyError',
  'instrumentOpenAiClient',
  'instrumentAnthropicAiClient',
  'instrumentGoogleGenAIClient',
  'instrumentStateGraph',
  'instrumentCreateReactAgent',
  'createLangChainCallbackHandler',
  'instrumentLangChainEmbeddings',
];

export const SENTRY_RULES: readonly SentryRule[] = [
  {
    id: 'with-sentry-config-import',
    leads: ['@sentry/nextjs'],
    summary: 'withSentryConfig and SentryBuildOptions moved to @sentry/nextjs/config',
    severity: 'breaking',
    kinds: ['removed', 'type'],
    symbols: symbols(['withSentryConfig', 'SentryBuildOptions']),
    message: named(['withSentryConfig', 'SentryBuildOptions']),
    detect: configImportSites,
    rewrite: moveConfigImport,
    guide:
      'Import (or require) withSentryConfig and the SentryBuildOptions type from "@sentry/nextjs/config"; that entry point already exists in 10.x, so only the module specifier changes. When the same import also takes runtime exports from "@sentry/nextjs", split it in two. next.config.js/.mjs are outside the TypeScript program: the build is what fails there.',
  },
  {
    id: 'build-options',
    leads: ['@sentry/nextjs'],
    summary:
      'top-level withSentryConfig options removed in 11 moved under webpack (or were renamed)',
    severity: 'breaking',
    kinds: ['removed', 'type'],
    symbols: symbols(Object.keys(BUILD_OPTIONS).map((k) => k.replace(/^.*\./, ''))),
    message: named(Object.keys(BUILD_OPTIONS).map((k) => k.replace(/^.*\./, ''))),
    detect: buildOptionSites,
    rewrite: moveBuildOption,
    guide: `Move each removed withSentryConfig option where 11 reads it, keeping its value: ${Object.entries(
      BUILD_OPTIONS,
    )
      .filter(([, to]) => to)
      .map(([from, to]) => `${from} → ${to}`)
      .join(
        '; ',
      )}; disableManifestInjection: x → routeManifestInjection: !x. unstable_sentryWebpackPluginOptions is gone: set each option it carried as a first-class build option (most often applicationKey); options with no first-class equivalent (release.uploadLegacySourcemaps, _experiments, disable) cannot be kept, say which in decisions. Merge into an existing webpack object rather than adding a second one. reactComponentAnnotation stays top-level (it now also drives Turbopack).`,
  },
  {
    id: 'send-default-pii',
    leads: ALL,
    summary:
      'sendDefaultPii is removed; dataCollection controls each category, with more permissive defaults',
    severity: 'breaking',
    kinds: [...INIT_KINDS],
    symbols: symbols(['sendDefaultPii']),
    message: named(['sendDefaultPii']),
    detect: initOptionSites(['sendDefaultPii']),
    guide: `sendDefaultPii no longer exists (${anchor('senddefaultpii-is-replaced-by-datacollection')}). Options: (a) sendDefaultPii: true — remove it, the v11 default collects the same; (b) sendDefaultPii: false or unset, keep v10's collection — replace it with the explicit baseline from the guide: dataCollection: { userInfo: false, cookies: false, httpHeaders: { request: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] }, response: { deny: [same] } }, httpBodies: [], urlQueryParams: { deny: [same] }, genAI: { inputs: false, outputs: false }, databaseQueryData: false, queues: false, graphQL: { document: false, variables: false } }; (c) accept the v11 defaults (cookies, request/response bodies, database queries, GenAI inputs and outputs, user IP). With sendDefaultPii: false, (b) is the default; (c) only if the owner asked for it. Keep an existing dataCollection, beforeSend scrubbing and requestDataIntegration include options. ${CHOOSE}`,
  },
  {
    id: 'enable-logs',
    leads: ALL,
    summary: 'enableLogs is removed: logs are sent whenever a logging API or integration is used',
    severity: 'breaking',
    kinds: [...INIT_KINDS],
    symbols: symbols(['enableLogs']),
    message: named(['enableLogs']),
    detect: initOptionSites(['enableLogs', '_experiments.enableLogs']),
    rewrite: removeDefaultedOption(['enableLogs', '_experiments.enableLogs'], true),
    guide:
      'enableLogs: true is removed (v11 sends logs whenever Sentry.logger.* or a logging integration is used). With enableLogs: false or a dynamic value there is no switch any more: options are to remove the Sentry.logger calls and logging integrations (consoleLoggingIntegration, Pino, Winston) that should not send, or to accept that they now send. Name the choice in decisions.',
  },
  {
    id: 'enable-metrics',
    leads: ALL,
    summary: 'enableMetrics is removed and beforeSendMetric moved to the top level',
    severity: 'breaking',
    kinds: [...INIT_KINDS],
    symbols: symbols(['enableMetrics', 'beforeSendMetric']),
    message: named(['enableMetrics']),
    detect: initOptionSites([
      'enableMetrics',
      '_experiments.enableMetrics',
      '_experiments.beforeSendMetric',
    ]),
    rewrite: removeDefaultedOption(['enableMetrics', '_experiments.enableMetrics'], true),
    guide:
      'enableMetrics: true is removed (metrics are sent whenever Sentry.metrics.* is used). Move _experiments.beforeSendMetric to a top-level beforeSendMetric unchanged. With enableMetrics: false there is no switch: remove the Sentry.metrics calls that should not send, or accept that they now send, and say which in decisions.',
  },
  {
    id: 'profiling-options',
    leads: ALL,
    summary: 'per-transaction profiling options are removed: profiling is session-based',
    severity: 'breaking',
    kinds: [...INIT_KINDS],
    symbols: symbols(['profilesSampleRate', 'profilesSampler']),
    message: named(['profilesSampleRate', 'profilesSampler']),
    detect: initOptionSites(['profilesSampleRate', 'profilesSampler']),
    guide: `profilesSampleRate and profilesSampler are removed (${anchor('browser-and-node-profiling')}). Replace them with profileSessionSampleRate and a profileLifecycle. Options: profileLifecycle: 'trace' (start and stop with active traces, closest to per-transaction profiling) or 'manual' (explicit profiler start/stop calls). A per-transaction rate is not a per-session rate: the volume of profiles changes. Keep an existing profileLifecycle. ${CHOOSE}`,
  },
  {
    id: 'ignore-transactions',
    leads: ALL,
    summary: 'ignoreTransactions is a no-op under span streaming, the v11 default',
    severity: 'breaking',
    kinds: [...INIT_KINDS],
    symbols: symbols(['ignoreTransactions']),
    message: named(['ignoreTransactions']),
    detect: initOptionSites(['ignoreTransactions'], ['traceLifecycle']),
    guide: `ignoreTransactions still compiles (deprecated) but does nothing with span streaming (${anchor('replacing-ignoretransactions-with-ignorespans')}). Options: (a) ignoreSpans with the same patterns — it matches every span, not only the root, so prefer the object form { name, attributes: { 'sentry.op': ... } } where a child span could share the name; (b) traceLifecycle: 'static' to keep transactions (temporary: planned for removal). Span names are low-cardinality in v11 and ignoreSpans runs at span start: a pattern matching a raw URL or SQL text may need to match url.path or db.query.text instead. ${CHOOSE}`,
  },
  {
    id: 'before-send-transaction',
    leads: ALL,
    summary: 'beforeSendTransaction is a no-op under span streaming, the v11 default',
    severity: 'breaking',
    kinds: [...INIT_KINDS],
    symbols: symbols(['beforeSendTransaction']),
    message: named(['beforeSendTransaction']),
    detect: initOptionSites(['beforeSendTransaction'], ['traceLifecycle']),
    guide: `beforeSendTransaction still compiles (deprecated) but no transaction events exist with span streaming (${anchor('replacing-beforesendtransaction')}). Options: (a) move scrubbing to beforeSendSpan guarded by span.is_segment, and dropping to ignoreSpans (beforeSendSpan cannot drop); (b) traceLifecycle: 'static' to keep transactions. Scope tags and extra no longer reach spans: use setAttribute(s). ${CHOOSE}`,
  },
  {
    id: 'span-json-format',
    leads: ALL,
    summary:
      'beforeSendSpan and spanToJSON use the streamed span format: description, op, data and timestamp are gone',
    severity: 'breaking',
    kinds: [],
    symbols: /$^/,
    detect: spanJsonSites,
    guide: `beforeSendSpan receives a StreamedSpanJSON and spanToJSON returns one (${anchor('beforesendspan-receives-the-streamed-span-format')}): description → name, data → attributes, op → attributes['sentry.op'], timestamp → end_timestamp, status is 'ok' | 'error'. A callback typed any compiles either way and reads undefined. Options: (a) migrate the reads to the streamed fields (attribute keys changed too: db.statement → db.query.text, http.method → http.request.method); (b) traceLifecycle: 'static' with the callback wrapped in Sentry.withStaticSpan (and spanToStaticSpanJSON for spanToJSON). ${CHOOSE}`,
  },
  {
    id: 'renamed-exports',
    leads: ALL,
    summary:
      'inboundFiltersIntegration, instrumentLangGraph, spanToStreamedSpanJSON, bfcacheIntegration and otlpIntegration were renamed',
    severity: 'breaking',
    kinds: ['removed', 'renamed', 'type'],
    symbols: symbols([
      'inboundFiltersIntegration',
      'instrumentLangGraph',
      'spanToStreamedSpanJSON',
      'bfcacheIntegration',
      'otlpIntegration',
    ]),
    message: named([
      'inboundFiltersIntegration',
      'instrumentLangGraph',
      'spanToStreamedSpanJSON',
      'bfcacheIntegration',
      'otlpIntegration',
    ]),
    detect: renamedExportSites,
    rewrite: renameExport,
    guide:
      'inboundFiltersIntegration → eventFiltersIntegration, instrumentLangGraph → instrumentStateGraph, spanToStreamedSpanJSON → spanToJSON, bfcacheIntegration → bfcacheMetricsIntegration: same arguments. otlpIntegration → openTelemetryIntegration takes no options and no longer sets up an exporter: configure your own exporter at Sentry.getOtlpTracesEndpoint(dsn) first, and import it from the server SDK, not @sentry/node-core/light/otlp.',
  },
  {
    id: 'integration-names',
    leads: ALL,
    summary: 'integrations compared by name report as EventFilters and OpenTelemetry',
    severity: 'breaking',
    kinds: [],
    symbols: /$^/,
    detect: integrationNameSites,
    rewrite: renameIntegrationName,
    guide:
      "An integration matched by its name string ('InboundFilters', 'OtlpIntegration') never matches in v11: they report as 'EventFilters' and 'OpenTelemetry'. The compiler sees only a string.",
  },
  {
    id: 'streamed-span-wrapper',
    leads: ALL,
    summary: 'withStreamedSpan is a deprecated no-op',
    severity: 'deprecated',
    kinds: ['deprecated'],
    symbols: symbols(['withStreamedSpan']),
    message: named(['withStreamedSpan']),
    detect: callSites(['withStreamedSpan'], (call) => call.arguments.length === 1),
    rewrite: unwrapStreamedSpan,
    guide:
      'beforeSendSpan: Sentry.withStreamedSpan(fn) is beforeSendSpan: fn; v11 passes streamed spans by default.',
  },
  {
    id: 'removed-modules',
    leads: ALL,
    summary:
      '@sentry/types, @sentry/node-core and the loader/preload/init entry points are not published in 11',
    severity: 'breaking',
    kinds: ['removed', 'type'],
    symbols: /^TS(?:2307|2305)$/,
    message: /@sentry\/(?:types|node-core|[\w-]+\/(?:loader|preload|init))/,
    detect: removedModuleSites,
    guide:
      "Import types from @sentry/core (or the platform SDK the repository already depends on) instead of @sentry/types, and everything from @sentry/node instead of @sentry/node-core. @sentry/<sdk>/loader, /preload and /init are gone: preload your own instrument file with node --import (or @sentry/<sdk>/import). @sentry/node-core/light/otlp's openTelemetryIntegration is exported by every server SDK. Do not add a dependency on a package that has no 11.x release.",
  },
  {
    id: 'core-subpaths',
    leads: ALL,
    summary:
      '@sentry/core exports only isomorphic code; browser- and server-only exports moved to subpaths',
    severity: 'breaking',
    kinds: ['removed', 'type'],
    symbols: /^TS(?:2305|2724|2614)$/,
    message: /'"@sentry\/core"'/,
    guide:
      'Import a server-only export (loadModule, trpcMiddleware, wrapMcpServerWithSentry, flushIfServerless, vercelWaitUntil, the HTTP and postgres helpers) from @sentry/core/server and a browser-only one (BrowserClientReplayOptions, the XHR/DOM handler types) from @sentry/core/browser, or keep importing it from the platform SDK that re-exports it. AI helpers moved to @sentry/server-utils. Several deprecated helpers were removed outright (addAutoIpAddressToUser, htmlTreeAsString, getLocationHref, supportsNativeFetch): replace them, never re-implement SDK internals.',
  },
  {
    id: 'removed-exports',
    leads: ALL,
    summary: 'exports and methods removed in 11 without a one-to-one replacement',
    severity: 'breaking',
    kinds: ['removed', 'type', 'signature'],
    symbols: symbols(REMOVED),
    message: new RegExp(
      `(?:^$|'clear' does not exist on type 'Scope'|'(?:${REMOVED.filter((n) => n !== 'clear').join('|')})')`,
    ),
    guide: `Removed in 11 (${anchor('3-removed-apis')}): Scope.clear() (use withScope/withIsolationScope for fresh state); SEMANTIC_ATTRIBUTE_SENTRY_SOURCE (set sentry.segment.name.source on the root span only); createSpanEnvelope; SentryContextManager, generateInstrumentOnce, preloadOpenTelemetry, validateOpenTelemetrySetup, setNodeAsyncContextStrategy (no longer needed: instrumentation is channel-based); honoIntegration and setupHonoErrorHandler (use @sentry/hono); connectIntegration and setupConnectErrorHandler (Connect is no longer instrumented); instrumentFastify and handleFastifyError (fastifyIntegration captures errors); AI client helpers in browser SDKs (server SDKs only). Remove the call when the guide says the SDK now does it; otherwise stop and say what cannot be migrated.`,
  },
  {
    id: 'opentelemetry-setup',
    leads: SERVER,
    summary: 'skipOpenTelemetrySetup and the custom OpenTelemetry hooks are removed',
    severity: 'breaking',
    kinds: [...INIT_KINDS],
    symbols: symbols(OTEL_OPTIONS),
    message: named(OTEL_OPTIONS),
    detect: initOptionSites(OTEL_OPTIONS),
    guide: `v11 no longer sets up OpenTelemetry for @sentry/node (${anchor('choosing-an-opentelemetry-setup')}); enableOpenTelemetrySetup replaces skipOpenTelemetrySetup with the inverse meaning (defaults: false on @sentry/node, true on @sentry/nextjs). Options: (1) Sentry only — remove the option (spans created through @opentelemetry/api are then ignored); (2) enableOpenTelemetrySetup: true — spans from @opentelemetry/api (e.g. a library's own instrumentation) become Sentry spans, with no exporter; (3) your own OpenTelemetry provider with Sentry.openTelemetryIntegration(), tracing off in Sentry, and your exporter pointed at Sentry.getOtlpTracesEndpoint(dsn). openTelemetrySpanProcessors, openTelemetryInstrumentations and openTelemetryBasicTracerProvider have no equivalent: a custom span processor or exporter only works in (3). skipOpenTelemetrySetup: true no longer turns off Sentry's HTTP/fetch spans. ${CHOOSE}`,
  },
  {
    id: 'removed-node-options',
    leads: SERVER,
    summary:
      'registerEsmLoaderHooks, disableInstrumentationWarnings and maxSpanWaitDuration are removed',
    severity: 'breaking',
    kinds: [...INIT_KINDS],
    symbols: symbols(NODE_OPTIONS),
    message: named(NODE_OPTIONS),
    detect: initOptionSites(NODE_OPTIONS),
    guide:
      'Instrumentation is channel-based in v11 (orchestrion), so registerEsmLoaderHooks and disableInstrumentationWarnings have nothing to configure: remove them. When registerEsmLoaderHooks: false was there to keep module hooks out of the way, the v11 switch for that is enableRuntimeChannelInjection: false; say in decisions whether you set it. maxSpanWaitDuration has no equivalent with span streaming.',
  },
  {
    id: 'http-integration-options',
    leads: SERVER,
    summary: 'httpIntegration options were renamed and its instrumentation hooks removed',
    severity: 'breaking',
    kinds: ['removed', 'type', 'signature'],
    symbols: symbols(Object.keys(HTTP_OPTIONS)),
    message: named(Object.keys(HTTP_OPTIONS)),
    detect: integrationOptionSites(
      ['httpIntegration', 'httpServerSpansIntegration'],
      Object.keys(HTTP_OPTIONS),
    ),
    rewrite: renameIntegrationOption(['httpIntegration'], {
      trackIncomingRequestsAsSessions: 'sessions',
      maxIncomingRequestBodySize: 'maxRequestBodySize',
      ignoreIncomingRequestBody: 'ignoreRequestBody',
      incomingRequestSpanHook: 'onSpanCreated',
    }),
    guide: `httpIntegration options (${anchor('httpintegration-options-were-consolidated')}): trackIncomingRequestsAsSessions → sessions, maxIncomingRequestBodySize → maxRequestBodySize, ignoreIncomingRequestBody → ignoreRequestBody, incomingRequestSpanHook → onSpanCreated. instrumentation.requestHook/responseHook/applyCustomAttributesOnSpan ran for both directions in v10; options: onSpanCreated (incoming requests), outgoingRequestHook/outgoingResponseHook/outgoingRequestApplyCustomAttributes (outgoing) — keep a hook that checked req instanceof IncomingMessage as onSpanCreated only. dropSpansForIncomingRequestStatusCodes maps to ignoreStatusCodes, which is deprecated and only works with traceLifecycle: 'static'; options are ignoreIncomingRequests or tracesSampler (decided before the response) or the static lifecycle. ${CHOOSE}`,
  },
  {
    id: 'error-handlers',
    leads: SERVER,
    summary:
      'setupExpress/Fastify/Koa/HapiErrorHandler are deprecated: the integrations capture errors themselves',
    severity: 'deprecated',
    kinds: ['deprecated'],
    symbols: symbols(ERROR_HANDLERS),
    message: named(ERROR_HANDLERS),
    detect: callSites(ERROR_HANDLERS, (call, name) => !passesHandlerOptions(call, name)),
    guide: `Koa and Hapi errors are captured automatically, as are Express (expressIntegration) and Fastify (fastifyIntegration) errors (${anchor('express-errors-are-captured-automatically')}). Options: remove the call when the matching integration is active (it is a default integration unless defaultIntegrations is false or the integration is filtered out), or keep it until v12. With defaultIntegrations: false, add the integration before removing the call. ${CHOOSE}`,
  },
  {
    id: 'error-handler-options',
    leads: SERVER,
    summary: 'setupExpressErrorHandler/setupFastifyErrorHandler no longer take shouldHandleError',
    severity: 'breaking',
    kinds: ['signature', 'type'],
    symbols:
      /(?:setupExpressErrorHandler|expressErrorHandler|setupFastifyErrorHandler|^TS(?:2554|2353|2559)$)/,
    message: /(?:^$|shouldHandleError|ExpressHandlerOptions)/,
    detect: callSites(
      ['setupExpressErrorHandler', 'expressErrorHandler', 'setupFastifyErrorHandler'],
      passesHandlerOptions,
    ),
    guide:
      'Move shouldHandleError to expressIntegration({ shouldHandleError }) / fastifyIntegration({ shouldHandleError }) in Sentry.init, with the same callback; the integration default captures 5xx and errors without a status. ExpressHandlerOptions is removed; ExpressIntegrationOptions comes from @sentry/node.',
  },
  {
    id: 'require-preload',
    leads: SERVER,
    summary: 'initializing through node --require is not supported in 11',
    severity: 'breaking',
    kinds: [],
    symbols: /$^/,
    detect: preloadSites,
    guide:
      'Preload the instrument file with node --import instead of --require/-r (it works for CommonJS too; the file extension decides). The @sentry/<sdk>/preload, /init and /loader entry points are removed: create an instrument file that calls Sentry.init and --import it, or use --import @sentry/<sdk>/import. Keep every other flag and preload in the script as it is.',
  },
  {
    id: 'browser-tracing-options',
    leads: BROWSER,
    summary: 'browserTracingIntegration options moved to dedicated integrations',
    severity: 'breaking',
    kinds: ['removed', 'type'],
    symbols: symbols(BROWSER_TRACING_OPTIONS),
    message: named(BROWSER_TRACING_OPTIONS),
    detect: integrationOptionSites(
      [
        'browserTracingIntegration',
        'reactRouterV3BrowserTracingIntegration',
        'reactRouterV4BrowserTracingIntegration',
        'reactRouterV5BrowserTracingIntegration',
        'reactRouterV6BrowserTracingIntegration',
        'reactRouterV7BrowserTracingIntegration',
        'reactRouterBrowserTracingIntegration',
        'tanstackRouterBrowserTracingIntegration',
        'webVitalsIntegration',
      ],
      BROWSER_TRACING_OPTIONS,
    ),
    guide: `Removed from browserTracingIntegration (${anchor('sentrybrowser')}): trackFetchStreamPerformance: true → add fetchStreamPerformanceIntegration(); ignorePerformanceApiSpans: [...] → add userTimingIntegration({ ignore: [...] }) (performance.mark/measure spans are not captured at all without it); _experiments.enableInteractions → add interactionsIntegration(); _experiments.enableStandaloneClsSpans/LcpSpans have no replacement (remove); beforeSpanEnd → beforeIdleSpanEnd. Add the new integration next to browserTracingIntegration in the same integrations array.`,
  },
  {
    id: 'breadcrumbs-console',
    leads: BROWSER,
    summary:
      'breadcrumbsIntegration no longer takes console: console breadcrumbs come from consoleIntegration',
    severity: 'breaking',
    kinds: ['removed', 'type'],
    symbols: symbols(['console']),
    message: /'console' does not exist in type '[^']*Breadcrumbs/,
    detect: integrationOptionSites(['breadcrumbsIntegration'], ['console']),
    guide:
      "console: false → filter the 'Console' integration out of the default integrations; console: true with defaultIntegrations: false → add consoleIntegration(). Remove the console key from breadcrumbsIntegration.",
  },
  {
    id: 'feedback-rejection',
    leads: BROWSER,
    summary: 'sendFeedback rejects with an Error in v11, never a string',
    severity: 'breaking',
    kinds: [],
    symbols: /$^/,
    detect: feedbackRejectionSites,
    guide:
      'A failed sendFeedback rejects with an Error whose message is the text v10 rejected with: read error.message instead of treating the rejection as a string. The catch variable is unknown/any, so the compiler cannot see this.',
  },
];

export function rulesFor(lead: Lead): SentryRule[] {
  return SENTRY_RULES.filter((rule) => rule.leads.includes(lead));
}
