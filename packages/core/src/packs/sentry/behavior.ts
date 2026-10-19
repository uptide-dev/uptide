import { ts } from 'ts-morph';
import type { BehaviorNote } from '../contract.js';
import type { PackContext } from '../types.js';
import { GUIDE } from './meta.js';
import type { Lead } from './rules.js';
import {
  initOptions,
  objectOf,
  parse,
  propertyAt,
  propertyName,
  sentryBindings,
  sentryCallee,
  unwrap,
  walk,
} from './syntax.js';

const SOURCE = /\.[cm]?[jt]sx?$/;
const files = (context: PackContext) => context.inventory ?? [];
const anchor = (section: string) => `${GUIDE.replace(/#.*$/, '')}#${section}`;

interface Init {
  file: string;
  keys: Set<string>;
  /** `tracesSampleRate: 0` or no tracing option at all. */
  tracing: boolean;
}

/** Every `Sentry.init` options object in the inventory, with its top-level keys. */
function inits(context: PackContext): Init[] {
  return files(context)
    .filter((f) => SOURCE.test(f.file))
    .flatMap((f) => {
      let objects: ts.ObjectLiteralExpression[];
      try {
        objects = initOptions(parse(f.text, f.file));
      } catch {
        return [];
      }
      return objects.map((object) => {
        const keys = new Set(object.properties.map(propertyName).filter((k): k is string => !!k));
        const rate = propertyAt(object, 'tracesSampleRate');
        const zero =
          rate && ts.isPropertyAssignment(rate) && unwrap(rate.initializer).getText() === '0';
        return {
          file: f.file,
          keys,
          tracing: keys.has('tracesSampler') || (keys.has('tracesSampleRate') && !zero),
        };
      });
    });
}

const list = (names: string[]) => [...new Set(names)].map((n) => `\`${n}\``).join(', ');

function note(
  id: string,
  summary: string,
  evidence: (context: PackContext) => string | boolean,
  option?: string,
): BehaviorNote {
  return {
    id,
    summary,
    reported: ['decision'],
    ...(option ? { option } : {}),
    applies(context) {
      const hit = evidence(context);
      return typeof hit === 'string' ? `${hit}: ${summary}` : hit;
    },
  };
}

/** Each manifest's declared version of a package, by file. */
function declared(context: PackContext, name: string): { file: string; range: string }[] {
  return files(context)
    .filter((f) => /(?:^|\/)package\.json$/.test(f.file))
    .flatMap((f) => {
      try {
        const pkg = JSON.parse(f.text) as Record<string, Record<string, string> | undefined>;
        const range =
          pkg.dependencies?.[name] ?? pkg.devDependencies?.[name] ?? pkg.peerDependencies?.[name];
        return range ? [{ file: f.file, range }] : [];
      } catch {
        return [];
      }
    });
}

/** Lowest major.minor.patch a range or pin allows, when it reads as one. */
function floor(range: string): [number, number, number] | undefined {
  const m = range.replace(/^npm:[^@]+@/, '').match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : undefined;
}
const below = (v: [number, number, number], min: [number, number, number]) =>
  v[0] !== min[0] ? v[0] < min[0] : v[1] !== min[1] ? v[1] < min[1] : v[2] < min[2];

function platform(context: PackContext, lead: Lead): string | false {
  const hits: string[] = [];
  const minimum = (name: string, min: [number, number, number], label: string) => {
    for (const d of declared(context, name)) {
      const v = floor(d.range);
      if (v && below(v, min)) hits.push(`\`${d.file}\` declares ${name} ${d.range} (${label})`);
    }
  };
  minimum('typescript', [5, 0, 4], 'v11 needs TypeScript 5.0.4');
  if (lead === '@sentry/nextjs') minimum('next', [14, 0, 0], 'v11 supports Next.js 14 and later');
  if (lead !== '@sentry/node') minimum('react', [17, 0, 0], 'v11 supports React 17 and later');
  if (lead === '@sentry/node' || lead === '@sentry/nextjs') {
    for (const f of files(context)) {
      if (/(?:^|\/)package\.json$/.test(f.file)) {
        try {
          const engine = (JSON.parse(f.text) as { engines?: { node?: string } }).engines?.node;
          const v = engine && floor(engine);
          if (engine && v && below(v, [20, 19, 0]))
            hits.push(`\`${f.file}\` engines.node is ${engine} (v11 needs Node 20.19.0)`);
        } catch {
          // A manifest that does not parse says nothing about the platform.
        }
      }
      if (/(?:^|\/)\.(?:nvmrc|node-version)$/.test(f.file)) {
        const v = floor(f.text.trim());
        if (v && below(v, [20, 19, 0]))
          hits.push(`\`${f.file}\` pins Node ${f.text.trim()} (v11 needs 20.19.0)`);
      }
    }
  }
  return hits.length ? hits.join('; ') : false;
}

/** `withSentryConfig(config, options)` build options in next.config, as key paths. */
function buildKeys(context: PackContext): { file: string; keys: string[] }[] {
  return files(context)
    .filter((f) => /(?:^|\/)next\.config\.[cm]?[jt]s$/.test(f.file))
    .flatMap((f) => {
      const source = parse(f.text, f.file);
      const bindings = sentryBindings(source, /^@sentry\/nextjs(?:\/config)?$/);
      const keys: string[] = [];
      walk(source, (node) => {
        if (
          ts.isCallExpression(node) &&
          sentryCallee(node.expression, bindings) === 'withSentryConfig'
        ) {
          const object = objectOf(node.arguments[1], source);
          for (const p of object?.properties ?? []) {
            const name = propertyName(p);
            if (!name) continue;
            keys.push(name);
            const inner = ts.isPropertyAssignment(p) ? unwrap(p.initializer) : undefined;
            if (inner && ts.isObjectLiteralExpression(inner))
              for (const q of inner.properties) {
                const sub = propertyName(q);
                if (sub) keys.push(`${name}.${sub}`);
              }
          }
        }
      });
      return keys.length ? [{ file: f.file, keys }] : [];
    });
}

export function sentryBehavior(lead: Lead): BehaviorNote[] {
  const browser = lead !== '@sentry/node';
  const server = lead === '@sentry/node' || lead === '@sentry/nextjs';
  const notes: (BehaviorNote | false)[] = [
    note(
      'data-collection',
      `with no dataCollection, v11 collects user info and IP, cookies, request and response headers and bodies, database queries, queue data and GenAI inputs/outputs; set dataCollection to keep v10's collection, or confirm the new defaults (${anchor('senddefaultpii-is-replaced-by-datacollection')})`,
      (c) => {
        const found = inits(c);
        if (!found.length) return true;
        const open = found.filter((i) => !i.keys.has('dataCollection'));
        return open.length
          ? `${list(open.map((i) => i.file))} call Sentry.init without dataCollection`
          : false;
      },
      'dataCollection',
    ),
    note(
      'span-streaming',
      `spans now stream as they end: beforeSendTransaction and ignoreTransactions do nothing, scope tags and extra no longer reach spans (use setAttribute), span names are low-cardinality and ops/attributes were renamed (dashboards, alerts and dynamic sampling rules keyed on them stop matching); traceLifecycle: 'static' opts out for now (${anchor('span-streaming-is-now-the-default')})`,
      (c) => {
        const traced = inits(c).filter((i) => i.tracing && !i.keys.has('traceLifecycle'));
        return traced.length ? `${list(traced.map((i) => i.file))} enable tracing` : false;
      },
    ),
    note(
      'sampling-filters',
      `tracesSampler and ignoreSpans now run when a span starts, before its route or final name is known: rules matching a name such as 'GET /health' stop matching silently; match url.path or other attributes instead (${anchor('filtering-and-sampling')})`,
      (c) => {
        const hits = inits(c).filter(
          (i) => i.keys.has('tracesSampler') || i.keys.has('ignoreSpans'),
        );
        return hits.length
          ? `${list(hits.map((i) => i.file))} set tracesSampler or ignoreSpans`
          : false;
      },
    ),
    note(
      'attach-stacktrace',
      `attachStacktrace now defaults to true: captureMessage and non-Error captureException attach a stack trace, which regroups issues and counts those sessions as errored; set attachStacktrace: false to keep v10 grouping (${anchor('attachstacktrace-defaults-to-true')})`,
      (c) => {
        const found = inits(c);
        if (!found.length) return false;
        const open = found.filter((i) => !i.keys.has('attachStacktrace'));
        return open.length
          ? `${list(open.map((i) => i.file))} leave attachStacktrace unset`
          : false;
      },
      'attachStacktrace',
    ),
    note(
      'trace-propagation-targets',
      `tracePropagationTargets now match case-insensitively and ignore the g and y regex flags: more outgoing requests may carry trace headers (${anchor('tracepropagationtargets-matching-is-now-case-insensitive')})`,
      (c) => {
        const hits = inits(c).filter((i) => i.keys.has('tracePropagationTargets'));
        return hits.length ? `${list(hits.map((i) => i.file))} set tracePropagationTargets` : false;
      },
    ),
    browser &&
      note(
        'browser-sessions-vitals',
        `browser release health and web vitals change: crashed sessions are reported as unhandled, a session no longer renews on navigation (browserSessionIntegration({ lifecycle: 'route' }) restores it), and LCP/CLS/INP are reported per soft navigation, so page-load values drop (${anchor('web-vitals-are-reported-per-soft-navigation')})`,
        (c) => {
          const client = inits(c).filter(
            (i) =>
              /(?:client|browser|instrumentation-client)|\.tsx$/i.test(i.file) ||
              lead !== '@sentry/nextjs',
          );
          return client.length
            ? `${list(client.map((i) => i.file))} initialize the browser SDK`
            : false;
        },
      ),
    server &&
      note(
        'opentelemetry-interop',
        `v11 no longer sets up OpenTelemetry for @sentry/node: spans created through @opentelemetry/api are ignored unless enableOpenTelemetrySetup: true (default on @sentry/nextjs), and custom span processors need your own provider (${anchor('choosing-an-opentelemetry-setup')})`,
        (c) => {
          const otel = files(c)
            .filter((f) => /(?:^|\/)package\.json$/.test(f.file))
            .flatMap((f) => {
              try {
                const pkg = JSON.parse(f.text) as Record<
                  string,
                  Record<string, string> | undefined
                >;
                const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter(
                  (n) => n.startsWith('@opentelemetry/'),
                );
                return names.length ? [`\`${f.file}\` depends on ${list(names)}`] : [];
              } catch {
                return [];
              }
            });
          return otel.length ? otel.join('; ') : false;
        },
      ),
    lead === '@sentry/nextjs' &&
      note(
        'vercel-environment',
        'on Vercel the default environment is now VERCEL_TARGET_ENV (production, preview) instead of vercel-production/vercel-preview; set environment explicitly to keep alert rules and saved searches matching',
        (c) => {
          const open = inits(c).filter((i) => !i.keys.has('environment'));
          return open.length ? `${list(open.map((i) => i.file))} leave environment unset` : false;
        },
      ),
    lead === '@sentry/nextjs' &&
      note(
        'tunnel-route',
        'tunnelRoute requests now run through middleware/proxy on webpack builds: exclude the tunnel path in the matcher (which needs a fixed tunnelRoute string, not true) if the middleware blocks unauthenticated requests',
        (c) => {
          const tunnel = buildKeys(c).filter((b) => b.keys.includes('tunnelRoute'));
          const middleware = files(c).filter((f) =>
            /^(?:src\/)?(?:middleware|proxy)\.[jt]s$/.test(f.file),
          );
          return tunnel.length && middleware.length
            ? `${list(tunnel.map((t) => t.file))} set tunnelRoute and ${list(middleware.map((m) => m.file))} exists`
            : false;
        },
      ),
    lead === '@sentry/nextjs' &&
      note(
        'react-component-annotation',
        'reactComponentAnnotation is a top-level option again and now also applies to Turbopack builds (Next.js 16+); webpack.reactComponentAnnotation is deprecated',
        (c) => {
          const hits = buildKeys(c).filter((b) =>
            b.keys.some(
              (k) => k === 'reactComponentAnnotation' || k === 'webpack.reactComponentAnnotation',
            ),
          );
          return hits.length
            ? `${list(hits.map((h) => h.file))} configure reactComponentAnnotation`
            : false;
        },
      ),
    {
      id: 'platform-minimums',
      summary: 'v11 requires Node 20.19.0, TypeScript 5.0.4, Next.js 14 and React 17 or later.',
      reported: ['decision'],
      applies: (c) => platform(c, lead),
    },
    {
      id: 'also-review',
      summary: `Also review the [v10 to v11 migration guide](${GUIDE}) for span name, op and attribute renames used in dashboards, alerts and beforeSendSpan.`,
      reported: ['decision'],
    },
  ];
  return notes.filter((n): n is BehaviorNote => n !== false);
}
