import { basename } from 'node:path';
import { lowTypeCoverage } from '../check/verdict.js';
import type { Finding } from '../domain/report.js';
import { BY } from '../domain/wording.js';
import { costStopMessage } from '../llm/fixer.js';
import { GENERIC_NOTE } from '../packs/generic.js';
import { UPTIDE_COMMAND } from '../version.js';
import { baselineHeadline, baselineHealthOf } from './baseline.js';
import type { BehaviorResult } from './behavior.js';
import { fitPieces, must, type Piece } from './budget.js';
import {
  describeOutOfScope,
  describeTransitive,
  type OutOfScopeChange,
} from './managers/lock-guard.js';
import { describeEresolveRetry } from './managers/upgrade.js';
import { noPackBlockers } from './no-pack.js';
import { uniqueSites } from './paired.js';
import { groupPeerBlockers, peerDescription } from './peer-preflight.js';
import { agentDecisionLines, testOutput } from './review-evidence.js';
import { sdkFallbackNote } from './sdk-agent.js';
import { stripeChangelog } from './stripe-changelog.js';
import { isTestFile } from './test-edits.js';
import type { FixDiagnostic, FixPhase, FixReport, FixSite, ReviewSection } from './types.js';
import { missingPackages, newDiagnostics } from './verify.js';

export function fixCounts(report: FixReport) {
  report = { ...report, sites: uniqueSites(report.sites) };
  return {
    mechanical: report.sites.filter((s) => s.outcome === 'mechanical').length,
    agent: report.sites.filter((s) => s.outcome === 'agent').length,
    manual: report.sites.filter((s) => s.outcome === 'manual').length,
  };
}
const hasFeedbackEdits = (report: FixReport): boolean =>
  (report.llm.tasks ?? []).some(
    (task) => task.id.startsWith('verification-') && Object.keys(task.diffs ?? {}).length > 0,
  );
const cell = (s: string) => s.replaceAll('|', '\\|').replace(/[\r\n]/g, ' ');
const sentence = (s: string) => {
  const text = s
    .replace(/(?:[\w.@-]+[/])+[\w.@-]+\.[\w]+/g, (path) => basename(path))
    .replace(/\s+/g, ' ');
  // `e.g.` and `i.e.` end no sentence: the first sentence is measured with them masked.
  const masked = text.replace(/\b(e|i)\.(g|e)\./g, '$1_$2_');
  const end = masked.match(/^.*?[.!?](?:\s|$)/)?.[0]?.length;
  const first = end === undefined ? text : text.slice(0, end).trim();
  return first.length > 240
    ? `${first.slice(0, 237)}…`
    : /[.!?…]$/.test(first)
      ? first
      : `${first}.`;
};
export const siteKey = (s: FixSite) =>
  `${s.finding.usage.file}:${s.finding.usage.line}:${s.finding.usage.column}`;
const folded = (s: FixSite) =>
  !!s.resolvedBy || s.reason.startsWith('diagnostic resolved by an earlier');

/** Compatibility for runs stored before stable rule IDs were recorded. */
export function changeRule(report: Pick<FixReport, 'package'>, s: FixSite): string {
  if (s.rule) return s.rule;
  if (s.finding.rule) return s.finding.rule;
  const evidence = `${s.finding.change.path} ${s.finding.usage.compileError ?? ''} ${s.finding.usage.snippet}`;
  if (report.package === 'zod') {
    if (s.outcome === 'mechanical')
      return /format/.test(s.reason) ? 'string-format' : 'error-params';
    if (/required_error|invalid_type_error/.test(evidence)) return 'error-params';
    if (/#ip$/.test(s.finding.change.path)) return 'ip';
    if (/ZodType|TS2724/.test(evidence) || folded(s)) return 'types';
  }
  if (report.package === 'stripe') {
    if (/apiVersion|LatestApiVersion/.test(evidence)) return 'api-version';
    if (/current_period_(?:end|start)/.test(evidence)) return 'subscription-period';
  }
  return s.finding.change.path;
}
/**
 * Rule wording shared by the PR body and the terminal: `title` is Markdown for the PR,
 * `plain` the terminal line when it should say more than the title does.
 */
export const RULE_TITLES: Record<string, { title: string; plain?: string }> = {
  'error-params': { title: 'New error API', plain: 'New error API (required_error → error)' },
  'string-format': { title: 'Top-level string formats' },
  ip: { title: '`.ip()` removed' },
  'api-version': { title: 'Stripe API version', plain: 'apiVersion no longer matches the SDK' },
  'api-version-unpinned': {
    title: 'Stripe API version unpinned',
    plain: 'client without apiVersion: the API version changes at runtime',
  },
  'api-version-pin': { title: 'Stripe API version pinned' },
  'subscription-period': { title: 'Subscription billing period moved to items' },
  'default-messages': { title: 'Default error messages' },
  'fixture-cast': { title: 'Test fixture casts widened' },
};
/**
 * A compiler-only finding in words; the raw message stays in `detail`. When every site says
 * the same thing, the title names it: the value, the type it has, the type now expected.
 */
export function diagnosticTitle(code: number, findings: Finding[]): string {
  const concrete = findings.map((f) => concreteTitle(code, f));
  const first = concrete[0];
  if (first && concrete.every((t) => t === first)) return first;
  const titles: Record<number, string> = {
    2305: 'An import no longer exists',
    2724: 'An import no longer exists',
    2614: 'An import no longer exists',
    2339: 'A property no longer exists',
    2551: 'A property no longer exists',
    2353: 'An option is no longer accepted',
    2554: 'A call passes the wrong number of arguments',
    2555: 'A call passes the wrong number of arguments',
    2769: 'A call no longer matches any signature',
    2345: 'An argument no longer has the expected type',
    2322: 'A value no longer has the expected type',
    2344: 'A type argument no longer satisfies its constraint',
    // A resource limit, not a location: which expression reports it varies by compiler version.
    2589: 'A type became too deep for the compiler to instantiate',
    2349: 'A value is no longer callable',
    2351: 'A value is no longer constructable',
    18046: 'A value became unknown',
    18048: 'A value may now be undefined',
    7006: 'A callback parameter lost its type',
  };
  return titles[code] ?? `Type error introduced by the upgrade (TS${code})`;
}

const typeOf = (text: string): string => (text.length > 40 ? `${text.slice(0, 37)}...` : text);
/** `billing_cycle_anchor no longer accepts a string (expects BillingCycleAnchor)`, from the message and the line. */
function concreteTitle(code: number, f: Finding): string | undefined {
  const message = f.usage.compileError?.split('\n')[0] ?? '';
  if (code === 2305 || code === 2724 || code === 2614) {
    const m = /has no exported member(?: named)? '([^']+)'/.exec(message);
    return m ? `${m[1]} is no longer exported` : undefined;
  }
  if (code === 2322) {
    const m = /^Type '(.+?)' is not assignable to type '(.+?)'\.?$/.exec(message);
    if (!m) return undefined;
    const name = /^\s*(?:[\w$.]+\.)?([\w$]+)\s*[:=](?!=)/.exec(f.usage.snippet)?.[1];
    return name
      ? `${name} no longer accepts a ${typeOf(m[1] as string)} (expects ${typeOf(m[2] as string)})`
      : `A ${typeOf(m[1] as string)} no longer satisfies ${typeOf(m[2] as string)}`;
  }
  if (code === 2345) {
    const m = /^Argument of type '(.+?)' is not assignable to parameter of type '(.+?)'\.?$/.exec(
      message,
    );
    if (!m) return undefined;
    return `An argument of type ${typeOf(m[1] as string)} no longer matches ${typeOf(m[2] as string)}`;
  }
  return undefined;
}

/** `types` is titled by what the sites show: the removed `ZodTypeDef`, or generics in general. */
export function ruleTitle(rule: string, zodTypeDef = false): string | undefined {
  if (rule === 'types') return zodTypeDef ? '`ZodTypeDef` removed' : 'Schema generics';
  return RULE_TITLES[rule]?.title;
}
interface Group {
  rule: string;
  outcome: FixSite['outcome'];
  sites: FixSite[];
  edits: FixSite[];
}
function groups(report: FixReport): Group[] {
  const result = new Map<string, Group>();
  for (const site of report.sites) {
    const parent = site.resolvedBy
      ? report.sites.find((s) => siteKey(s) === site.resolvedBy)
      : folded(site)
        ? report.sites.find(
            (s) =>
              s.outcome === 'agent' &&
              !folded(s) &&
              s.finding.usage.file === site.finding.usage.file,
          )
        : undefined;
    const rule = changeRule(report, parent ?? site);
    const key = rule;
    const group = result.get(key) ?? { rule, outcome: site.outcome, sites: [], edits: [] };
    if (site.outcome === 'manual' || (site.outcome === 'agent' && group.outcome === 'mechanical'))
      group.outcome = site.outcome;
    group.sites.push(site);
    if (!folded(site)) group.edits.push(site);
    result.set(key, group);
  }
  return [...result.values()].sort(
    (a, b) =>
      Number(a.outcome !== 'mechanical') - Number(b.outcome !== 'mechanical') ||
      a.rule.localeCompare(b.rule),
  );
}
function description(
  g: Group,
  report: FixReport,
): { title: string; summary: string; note?: string } {
  if (g.outcome === 'manual')
    return {
      title: g.rule,
      summary: `Manual migration required: ${sentence(g.sites.find((s) => s.outcome === 'manual')?.reason ?? 'review the remaining sites.')}`,
    };
  // Everything said about a rule comes from this run's own sites: the file that was edited and
  // the type the accepted patch wrote. No repository's names live in the renderer.
  const edited = g.edits[0];
  const patch =
    edited?.diff ?? edited?.attempts?.findLast((a) => a.outcome === 'accepted')?.diff ?? '';
  const zodTypeDef = g.sites.some((s) =>
    /ZodTypeDef/.test(
      `${s.finding.usage.compileError ?? ''} ${s.finding.usage.snippet} ${s.diff ?? ''} ${s.attempts?.map((a) => a.diff ?? '').join(' ') ?? ''}`,
    ),
  );
  const declaration = edited
    ? basename(edited.finding.usage.file).replace(/\.[cm]?[jt]sx?$/, '')
    : undefined;
  const generic = /^\+.*?(ZodType<[^>\n]+>)/m.exec(patch)?.[1] ?? 'ZodType<Output, Input>';
  const known: Record<string, { title: string; summary: string; note?: string }> = {
    'error-params': {
      title: ruleTitle('error-params') as string,
      summary:
        '`required_error` and `invalid_type_error` were replaced by `error`. ' +
        (schemas(report).some(
          (b) =>
            b.messageChecks?.some((c) => c.status === 'different') ||
            b.differences.some((d) => /message|issue/.test(d.kind)),
        )
          ? 'Message differences need review.'
          : 'Messages are unchanged.'),
      note: "Returning `undefined` keeps zod's default message for wrong types, exactly like v3.",
    },
    'string-format': {
      title: ruleTitle('string-format') as string,
      summary:
        'String format chains now use top-level factories, preserving arguments and subsequent checks.',
    },
    ip: {
      title: ruleTitle('ip') as string,
      summary: g.edits.every(
        (s) =>
          /z\.union/.test(s.diff ?? '') && /ipv4/.test(s.diff ?? '') && /ipv6/.test(s.diff ?? ''),
      )
        ? 'Now `z.union([z.ipv4(), z.ipv6()])`, which accepts both families like before.'
        : 'Uses the target IP factories; review the accepted patch for address-family semantics.',
    },
    types: {
      title: ruleTitle('types', zodTypeDef) as string,
      summary:
        zodTypeDef && declaration
          ? `\`${declaration}\` now types schemas as \`${generic}\`, preserving the input/output contract.`
          : 'Schema declarations use the target output/input generics; no new type errors were introduced.',
    },
    'api-version': {
      title: ruleTitle('api-version') as string,
      summary: additiveBumpOnly(report)
        ? 'API literals now match the target SDK. No changelog entry between the two API versions affects this code, and none is breaking.'
        : 'API literals now match the target SDK; types compile, but response and webhook compatibility needs review.',
    },
    'default-messages': {
      title: ruleTitle('default-messages') as string,
      summary:
        'Zod 4 words its default messages differently. Assertions that the migrated code made fail now match the new text; the tests pass again.',
    },
    'subscription-period': {
      title: ruleTitle('subscription-period') as string,
      summary:
        'One shared helper takes the item that ends last and returns start and end from that same item (undefined with no items), preserving the single-item values; multi-item and no-item behavior needs your decision.',
    },
    'api-version-unpinned': {
      title: 'Stripe API version unpinned',
      summary: `A client created without \`apiVersion\` spoke the SDK's default; it now says \`${report.apiChanges?.to ?? 'the target version'}\` explicitly, the version the new SDK's types describe. The next SDK bump cannot move it silently.`,
    },
    'fixture-cast': {
      title: ruleTitle('fixture-cast') as string,
      summary:
        'Test fixtures that were already cast straight to an SDK type no longer overlap with it, so the same cast now goes through `unknown`. No application code and no new assertion: the tests decide whether the fixtures still hold.',
    },
    'api-version-pin': {
      title: ruleTitle('api-version-pin') as string,
      summary: `\`apiVersion: '${report.apiVersion ?? ''}'\` added to a client that relied on the SDK default. Identical behaviour: this is the version the installed SDK already speaks. The next SDK bump no longer changes it silently.`,
    },
  };
  return (
    known[g.rule] ?? {
      title: /^TS\d+$/.test(g.rule)
        ? diagnosticTitle(
            Number(g.rule.slice(2)),
            g.sites.map((s) => s.finding),
          )
        : g.rule,
      summary: `${sentence(g.edits[0]?.attempts?.findLast((a) => a.outcome === 'accepted')?.explanation ?? g.edits[0]?.reason ?? 'Migration recorded.')} ${report.verification.passed ? 'No new type errors.' : 'Verification is incomplete.'}`,
    }
  );
}
function schemas(report: FixReport): BehaviorResult[] {
  return (report.behavior ?? []).filter((b) => b.schema !== '(reported site)');
}
function differs(b: BehaviorResult): boolean {
  return (
    b.differences.length > 0 ||
    (!b.skipped && b.identical !== b.inputs) ||
    !!b.messageChecks?.some((c) => c.status === 'different')
  );
}
function unchecked(b: BehaviorResult): boolean {
  return !!b.skipped || !b.inputs || !!b.messageChecks?.some((c) => c.status === 'skipped');
}
/**
 * A stripe run whose only rule is the API version pin, between two versions whose changelog has
 * no entry with evidence in the code and no breaking entry at all.
 */
function additiveBumpOnly(report: FixReport): boolean {
  const c = report.apiChanges;
  return (
    report.package === 'stripe' &&
    !!c &&
    c.relevant === 0 &&
    c.breaking === 0 &&
    groups(report).every((g) => g.rule === 'api-version')
  );
}
export function migrationRisk(report: FixReport): {
  level: 'Low' | 'Medium' | 'High';
  reason: string;
} {
  if (report.verificationPending) return { level: 'High', reason: 'verification pending' };
  if (
    report.mode === 'pin' &&
    report.verification.passed &&
    !report.sites.some((s) => s.outcome === 'manual')
  )
    return { level: 'Low', reason: 'no behaviour change: the explicit pin equals the SDK default' };
  const g = groups(report);
  const high = [
    ...(report.packWarning ? [report.packWarning] : []),
    ...(report.peerConflicts?.length ? ['peer compatibility is not verified'] : []),
    ...(report.companionBlockers?.length ? ['a required move is blocked'] : []),
    ...(report.companions?.some((c) => c.migration === 'own')
      ? ['a companion major needs its own migration']
      : []),
    ...(report.sites.some((s) => s.outcome === 'manual') ? ['manual sites left'] : []),
    ...(!report.verification.passed ||
    report.verification.newErrors.length ||
    report.sites.some((s) => s.finding.severity === 'unverified')
      ? ['unverified sites']
      : []),
    ...(schemas(report).some(differs) ||
    (report.package === 'stripe' &&
      g.some((x) => ['api-version', 'subscription-period'].includes(x.rule)) &&
      !additiveBumpOnly(report))
      ? ['behavior changes']
      : []),
  ];
  if (high.length) return { level: 'High', reason: high.join('; ') };
  if (hasFeedbackEdits(report))
    return { level: 'Medium', reason: 'agent edits after verification feedback need review' };
  // No pack: nothing analyzed the upgrade, so its build and tests passing is not Low either.
  if (report.tier === 'generic' && report.sites.length === 0)
    return {
      level: 'Medium',
      reason: `no migration pack for ${report.package}: the bump is verified by the repository's own checks only`,
    };
  // Nothing edited and the repository's own tests pass: the bump alone, verified.
  if (
    report.sites.length === 0 &&
    report.verification.tests.length > 0 &&
    report.verification.tests.every((t) => t.status === 'passed')
  )
    return { level: 'Low', reason: 'no code changes; types and tests verified' };
  // No pack: nothing but the compiler vouches for the agent's edits. Never Low.
  if (report.tier === 'generic')
    return {
      level: 'Medium',
      reason: `no migration pack for ${report.package}: agent edits verified by the compiler only`,
    };
  // The changelog between the two API versions touches nothing this code uses and breaks
  // nothing: what is left is that this is billing code, which is why it is not Low.
  if (additiveBumpOnly(report))
    return {
      level: 'Medium',
      reason: 'billing path; API version bump with additive changes only',
    };
  if (
    report.package === 'zod' &&
    report.sites.some((s) =>
      /(?:schemas|validation|auth|webhook|instance)/i.test(s.finding.usage.file),
    )
  ) {
    const scopes = validationScopes(report);
    return {
      level: 'Medium',
      reason: `request validation${scopes.length ? ` in ${scopeList(report)}` : ''}`,
    };
  }
  const medium = [
    ...(report.sites.some((s) => s.outcome === 'agent') ? ['agent edits'] : []),
    ...(report.sites.some((s) =>
      /(?:validation|auth|billing|payment|webhook)/i.test(s.finding.usage.file),
    )
      ? ['sensitive paths']
      : []),
    ...(!report.verification.tests.length ||
    report.verification.tests.some((t) => t.status === 'missing')
      ? ['no tests']
      : []),
    ...(schemas(report).some(unchecked) ? ['unchecked schemas'] : []),
  ];
  return medium.length
    ? { level: 'Medium', reason: medium.join('; ') }
    : { level: 'Low', reason: 'rule-only; all verified' };
}
/** What the changed schemas validate, read off the run's own file paths. */
function validationScopes(report: FixReport): string[] {
  const paths = report.sites
    .flatMap((s) => [s.finding.usage.file, ...(s.editedFiles ?? [])])
    .join(' ');
  return [
    ...(/auth|user\.ts/i.test(paths) ? ['auth'] : []),
    ...(/instance/i.test(paths) ? ['instances'] : []),
    ...(/webhook/i.test(paths) ? ['webhooks'] : []),
  ];
}
/** `web, worker and api`. */
const listed = (items: string[]): string =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
const scopeList = (report: FixReport): string => listed(validationScopes(report));
/** `75 pre-existing errors (74 × TS2688/TS2591 missing Node types, 1 × TS2322)`. */
export function errorSummary(diagnostics: FixDiagnostic[], what: string): string {
  const byKind = new Map<string, { codes: Set<number>; n: number }>();
  for (const d of diagnostics) {
    const missing = missingPackages(d)[0];
    const kind = missing
      ? ` missing ${missing === '@types/node' ? 'Node types' : `\`${missing}\``}`
      : `|${d.code}`;
    const entry = byKind.get(kind) ?? { codes: new Set(), n: 0 };
    entry.codes.add(d.code);
    entry.n++;
    byKind.set(kind, entry);
  }
  const parts = [...byKind]
    .sort((a, b) => b[1].n - a[1].n)
    .map(
      ([kind, { codes, n }]) =>
        `${n} × ${[...codes].map((c) => `TS${c}`).join('/')}${kind.startsWith('|') ? '' : kind}`,
    );
  return `${count(diagnostics.length, what)} (${parts.join(', ')})`;
}
const count = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;
/** The repository's own lint on the edited files, appended to the Tests cell. */
function lintCell(report: FixReport): string {
  const lint = report.verification.lint ?? [];
  if (!lint.length) return '';
  const tools = (status: string): string =>
    lint
      .filter((l) => l.status === status)
      .map((l) => l.tool)
      .join(', ');
  if (tools('failed')) return ` · ❌ lint fails (${tools('failed')})`;
  if (tools('pre-existing')) return ` · ⚠️ lint was already failing (${tools('pre-existing')})`;
  return ` · lint clean (${tools('passed')})`;
}
/** What ran and how it went, in one cell: the counts the runner printed and how the scope was chosen. */
function testsRow(report: FixReport): string {
  const all = report.verification.tests;
  const names = (ts: typeof all): string =>
    ts
      .flatMap((t) => t.covers ?? [t.workspace])
      .map((w) => (w === '.' ? 'the repository' : `\`${basename(w)}\``))
      .join(' or ');
  const failed = all.filter((t) => ['failed', 'timeout'].includes(t.status) && !t.preexisting);
  if (failed.length) return `❌ ${failed.length} failed or timed out`;
  const missing = all.filter((t) => t.status === 'missing');
  const passed = all.filter((t) => t.status === 'passed');
  const preexisting = all.filter((t) => t.preexisting);
  const before = preexisting.length
    ? ` · ⚠️ ${names(preexisting)}: ${(() => {
        const files = preexisting.flatMap((t) => t.preexisting ?? []).filter((f) => f !== '*');
        return files.length ? count(files.length, 'test file') : 'the run';
      })()} already failing before the change`
    : '';
  if (preexisting.length && !passed.length)
    return `⚠️ ${names(preexisting)}: ${preexisting.flatMap((t) => t.preexisting ?? []).filter((f) => f !== '*').length || 'the run'} already failing before the change; nothing else ran`.replace(
      /: (\d+) already/,
      (_, n) => `: ${count(Number(n), 'test file')} already`,
    );
  if (!all.length) return '⚠️ no tests ran';
  if (!passed.length)
    // Runs stored before the scope was recorded only know there was no script.
    return missing.every((t) => !t.scope)
      ? `⚠️ no test script in ${names(missing)}`
      : `⚠️ no tests ran: ${missing[0]?.command ? 'none relate to the affected files' : `no test script or runner configuration for ${names(missing)}`}`;
  const counted = passed.filter((t) => t.summary);
  // "3 tests in 2 files" and "2 tests in 1 file" are one fact: 5 tests in 3 files.
  const parts = counted.map((t) => /^(\d+) tests? in (\d+) files?$/.exec(t.summary ?? ''));
  const total = parts.every((m) => m !== null)
    ? `${count(
        parts.reduce((n, m) => n + Number(m?.[1]), 0),
        'test',
      )} in ${count(
        parts.reduce((n, m) => n + Number(m?.[2]), 0),
        'file',
      )}`
    : counted.map((t) => t.summary).join(' + ');
  const what =
    counted.length === passed.length
      ? `${total} passed`
      : `${count(passed.length, 'workspace')} passed`;
  const scopes = [...new Set(passed.map((t) => t.scope).filter(Boolean))];
  // Runs scoped to the affected files say so in plain words; how the scope was chosen is in the details.
  const relatedCounts = passed.map((t) =>
    /tests related to/.test(t.scope ?? '') ? /^(\d+) tests?/.exec(t.summary ?? '')?.[1] : undefined,
  );
  const related = relatedCounts.every((n) => n !== undefined)
    ? relatedCounts.reduce((sum, n) => sum + Number(n), 0)
    : undefined;
  const skipped = all.reduce((n, t) => n + (t.notRun?.files ?? 0), 0);
  const left = skipped ? ` · ⚠️ ${count(skipped, 'integration test file')} not run` : '';
  const retried = passed.flatMap((t) => t.retried ?? []);
  const rerun = retried.length
    ? ` · ${count(retried.length, 'unrelated test')} failed once and passed on rerun`
    : '';
  if (related !== undefined)
    return `✅ ${related} related ${skipped ? 'unit ' : ''}test${related === 1 ? '' : 's'} passed${rerun}${left}${before}${missing.length ? ` · ⚠️ no tests for ${names(missing)}` : ''}`;
  return `✅ ${what}${scopes.length === 1 ? ` · ${scopes[0]}` : ''}${rerun}${left}${before}${missing.length ? ` · ⚠️ no tests for ${names(missing)}` : ''}`;
}
const sentenceCase = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
/** `12 API changes, none affect your code, all additive`: the changelog against the code's evidence. */
export function apiChangeSummary(c: NonNullable<FixReport['apiChanges']>): string {
  const changes = count(c.total, 'API change');
  if (c.total === 0) return 'no API changes';
  const more = c.resources
    ? ` · ${c.resources.total} touch resources you use (${c.resources.breaking} breaking)`
    : '';
  if (c.relevant > 0)
    return `${c.relevant} of ${changes} affect${c.relevant === 1 ? 's' : ''} your code${more}`;
  const nature =
    c.breaking === 0
      ? c.total === 1
        ? 'additive'
        : 'all additive'
      : `${c.breaking} breaking for surfaces you do not use`;
  return `${changes}, none affect${c.total === 1 ? 's' : ''} your code, ${nature}`;
}
/**
 * What vouches for the run and how: the pack, the type-check, the build and the tests, each
 * named with whether it ran and passed. A reviewer never reads "verified" for a check that did
 * not run: a bump nothing analyzed says so here.
 */
export function verifiedBy(report: FixReport): string {
  if (report.verificationPending) return '⚠️ nothing yet: verification pending';
  const v = report.verification;
  const pack = report.packWarning
    ? [`⚠️ ${report.packWarning}`]
    : report.mode === 'pin' || !report.tier
      ? []
      : report.tier === 'verified'
        ? [`✅ the ${report.package} migration pack`]
        : [`⚠️ no migration pack: nothing analyzed what ${report.package} ${report.target} changes`];
  const low = lowTypeCoverage(report.typeCoverage);
  const types = v.typesUnverified
    ? '⚠️ type-check not verified (type resolution failed)'
    : v.newErrors.length
      ? '❌ type-check'
      : low
        ? `⚠️ type-check is not proof: ${low}`
        : '✅ type-check';
  const failing = (s: string) => s === 'failed' || s === 'timeout';
  // Name the result of each verification step, including pack-required builds.
  const build = !v.build
    ? report.tier === 'generic' || v.buildRequired
      ? '⚠️ build not run'
      : report.packWarning
        ? 'build not required by this candidate pack'
        : 'build not required (pack-verified migration)'
    : !v.build.length || v.build.some((b) => b.status === 'missing')
      ? '⚠️ build not run: no build script'
      : v.build.some((b) => failing(b.status))
        ? `❌ build${buildCauseText(v.build)}`
        : '✅ build';
  const ran = v.tests.filter((t) => t.status !== 'missing');
  const tests = !ran.length
    ? '⚠️ tests not run: none ran'
    : ran.some((t) => failing(t.status) && !t.preexisting)
      ? '❌ tests'
      : ran.some((t) => t.preexisting)
        ? '⚠️ tests already failing before the change'
        : `✅ tests (${count(ran.length, 'run')})`;
  return [
    ...pack,
    types,
    build,
    tests,
    ...(low ? ['the verdict rests on tests and build'] : []),
  ].join(' · ');
}
/** The facts of a run, in the words the PR table uses: risk, changes, types, behavior, tests, and what verified it. */
export function summaryCells(report: FixReport): {
  verified: string;
  risk: string;
  changes: string;
  types: string;
  behavior: string;
  tests: string;
} {
  report = { ...report, sites: uniqueSites(report.sites) };
  const c = fixCounts(report),
    risk = migrationRisk(report),
    bs = schemas(report);
  const identical = bs.filter((b) => !unchecked(b) && !differs(b)).length;
  const tests = `${testsRow(report)}${lintCell(report)}`;
  const changes = !report.sites.length
    ? 'none: versions and lockfile only'
    : `${count(report.sites.length, 'site')} in ${new Set(report.sites.flatMap((s) => [s.finding.usage.file, ...(s.editedFiles ?? [])])).size} file${new Set(report.sites.flatMap((s) => [s.finding.usage.file, ...(s.editedFiles ?? [])])).size === 1 ? '' : 's'}${report.verificationPending ? ' · analysis only' : ` · ${BY.ruleDone(c.mechanical)} · ${BY.agentDone(c.agent)}${c.manual ? ` · ${c.manual} manual` : ''}`}`;
  const changeSummary = report.changedFiles
    ? `${count(report.sites.length, 'site')} · ${count(report.changedFiles.length, 'changed file')} · ${BY.ruleDone(c.mechanical)} · ${BY.agentDone(c.agent)}${c.manual ? ` · ${c.manual} manual` : ''}`
    : changes;
  const messages = bs.flatMap((b) => b.messageChecks ?? []).filter((c) => c.status !== 'default');
  const messageSummary = messages.length
    ? ` · ${messages.filter((c) => c.status === 'identical').length}/${messages.length} custom-message assertions`
    : '';
  const behavior = bs.length
    ? `${bs.some(differs) ? '⚠️' : '✅'} ${count(identical, 'schema')} identical${bs.filter(unchecked).length ? ` · ${bs.filter(unchecked).length} not checked` : ''}${bs.some(differs) ? ` · ${bs.filter(differs).length} with differences` : ''}${messageSummary}`
    : report.apiChanges
      ? `${report.apiChanges.relevant ? '⚠️' : '✅'} ${apiChangeSummary(report.apiChanges)}`
      : report.mode === 'pin'
        ? `✅ unchanged: \`${report.apiVersion}\` is what the installed SDK already defaults to`
        : '⚠️ not checked';
  return {
    verified: verifiedBy(report),
    risk: `${risk.level}: ${cell(risk.reason)}`,
    changes: changeSummary,
    types: report.verificationPending
      ? '⚠️ verification pending'
      : report.verification.typesUnverified
        ? '⚠️ not verified (type resolution failed)'
        : typesCell(report),
    behavior,
    tests: cell(report.verificationPending ? '⚠️ not run' : tests),
  };
}
/**
 * What the upgrade broke and what Uptide left: errors right after the bump that the repository
 * did not have before (the bump moves no source line, so they compare as they are), then the
 * new errors once the migration is done.
 */
function typesCell(report: FixReport): string {
  const v = report.verification;
  // Too few affected files type-checked: zero errors is not a pass, and the cell leads with why.
  const low = lowTypeCoverage(report.typeCoverage);
  const mark = v.newErrors.length ? '❌' : low ? '⚠️' : '✅';
  const pre = v.baseline.length ? ` (${v.baseline.length} pre-existing, not counted)` : '';
  const scope = low ? `${low}, not proof · ` : '';
  if (report.mode === 'pin')
    return `${mark} ${scope}${count(v.target.length, 'error')} before → ${v.after.length}${pre}`;
  const broke = newDiagnostics(v.baseline, v.target).length;
  return `${mark} ${scope}the upgrade broke ${broke} · Uptide left ${v.newErrors.length}${pre}`;
}
function summaryRows(report: FixReport): string[] {
  const c = summaryCells(report);
  return [
    '| | |',
    '|---|---|',
    `| **Verified by** | ${c.verified} |`,
    `| **Risk** | ${c.risk} |`,
    `| **Changes** | ${c.changes} |`,
    `| **Types** | ${c.types} |`,
    `| **Behavior** | ${c.behavior} |`,
    `| **Tests** | ${c.tests} |`,
  ];
}
const heading = (g: Group, report: FixReport, i: number) => {
  const sources = [...new Set(g.sites.map((s) => s.outcome))]
    .map((source) =>
      source === 'mechanical' ? BY.ruleDoneTag : source === 'agent' ? BY.agentDoneTag : 'manual',
    )
    .sort();
  return `**${i + 1}. ${description(g, report).title}** · ${g.edits.length !== g.sites.length ? `${g.edits.length} fix${g.edits.length === 1 ? '' : 'es'}, ${count(g.sites.length, 'error')}` : `${g.sites.length} site${g.sites.length === 1 ? '' : 's'}`} · ${sources.join(' + ')}`;
};
const collapse = (label: string, lines: string[]) => [
  `<details><summary>${label}</summary>`,
  '',
  ...lines,
  '',
  '</details>',
];

/** One renderer for PR descriptions, sticky comments and terminal summaries. */
/**
 * GitHub documents a 65,536-character PR body limit:
 * https://github.com/orgs/community/discussions/27190#discussioncomment-3254953
 * 60,000 UTF-16 code units leaves 5,536 characters of margin (and counts astral characters
 * conservatively). Apply after command expansion, including every wrapper and trim notice.
 */
export const PR_BODY_BUDGET = 60_000;
/**
 * A droppable block: kept whole, or replaced by one line saying it was left out. A PR
 * description is read on GitHub, by people who do not have the author's machine: it never
 * points at a local file.
 */
const droppable = (rank: number, block: string[], what: string): Piece => ({
  kind: 'text',
  text: block.join('\n'),
  rank,
  alt: `_${what} omitted to fit the PR body budget. Full text is retained in report.json; see the job summary for verification results when run in Actions._`,
});
/** How many entries a list cut down to its compact form still names. */
const FIRST = 10;
/** Where every list is in full: report.json, and the job summary when the run was in Actions. */
const fullLists = (report: FixReport): string =>
  `report.json${report.runUrl ? ` and the [job summary](${report.runUrl})` : ''}`;
/**
 * A list no budget may drop: whole when it fits, else its compact form, which still counts
 * every entry and names the first ones. It gives way before anything droppable.
 */
const shortened = (text: string[], compact: string[]): Piece => ({
  kind: 'text',
  rank: 1,
  text: text.join('\n'),
  alt: compact.join('\n'),
});
/** Lockfile entries: whole, or counts per kind of change and the first packages. */
function lockfileChanges(heading: string[], changes: OutOfScopeChange[], report: FixReport): Piece {
  const kinds = new Map<string, number>();
  for (const c of changes) {
    const kind = !c.from
      ? 'added'
      : !c.to
        ? 'removed'
        : c.from === c.to
          ? 're-resolved at the same version'
          : 'version changed';
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  }
  const line = (c: OutOfScopeChange) => `- ${describeOutOfScope(c)}`;
  return shortened(
    [...heading, ...changes.map(line)],
    [
      ...heading,
      `${changes.length} ${changes.length === 1 ? 'entry' : 'entries'}: ${[...kinds].map(([kind, n]) => `${n} ${kind}`).join(', ')}. The first ${FIRST}; all of them are in ${fullLists(report)}.`,
      '',
      ...changes.slice(0, FIRST).map(line),
    ],
  );
}
/** Sites to change by hand: one line each, or per rule a count and the first locations. */
function manualSites(sites: FixSite[], report: FixReport): Piece {
  const byRule = new Map<string, FixSite[]>();
  for (const s of sites)
    byRule.set(s.rule ?? 'other', [...(byRule.get(s.rule ?? 'other') ?? []), s]);
  const shown = 5;
  return shortened(
    sites.map(
      (s) =>
        `- Manual: \`${basename(s.finding.usage.file)}:${s.finding.usage.line}\` — ${sentence(s.reason)}`,
    ),
    [
      `- Manual: ${count(sites.length, 'site')} to change by hand, by rule; each one with its reason is in ${fullLists(report)}.`,
      ...[...byRule].map(
        ([rule, list]) =>
          `  - \`${rule}\` (${list.length}): ${list
            .slice(0, shown)
            .map((s) => `\`${s.finding.usage.file}:${s.finding.usage.line}\``)
            .join(', ')}${list.length > shown ? `, and ${list.length - shown} more` : ''}`,
      ),
    ],
  );
}
/**
 * The description when even the compact sections do not fit: what was checked and how many of
 * everything, and where the rest is. Its size does not grow with the run.
 */
function minimalBody(report: FixReport, title: string): string {
  const v = report.verification;
  const sites = (outcome: FixSite['outcome']) =>
    report.sites.filter((s) => s.outcome === outcome).length;
  const tests = (status: string) => v.tests.filter((t) => t.status === status).length;
  const lock = report.lockfile;
  return [
    title,
    '',
    `> ⚠️ **Shortened description.** This run's evidence does not fit GitHub's size limit even in compact form, so this is its summary. Every section is in ${fullLists(report)}.`,
    '',
    ...(report.agentFallback?.length
      ? [
          '> ⚠️ **Agent-led draft.** The mechanical path stopped; the reasons are in report.json.',
          '',
        ]
      : []),
    `**Review required before merging.** Verification: ${v.passed ? 'PASS' : 'FAIL'}.`,
    '',
    '### Checks',
    '',
    `- Type errors: baseline ${v.baseline.length}; after ${v.after.length}; ${v.newErrors.length} new.`,
    `- Tests: ${v.tests.length ? `${tests('passed')} passed, ${tests('failed') + tests('timeout')} failed or timed out, ${tests('missing')} missing` : 'none ran'}.`,
    ...(v.build?.length
      ? [
          `- Builds: ${v.build.filter((b) => b.status === 'passed').length} of ${v.build.length} passed.`,
        ]
      : []),
    ...(v.lint?.length
      ? [
          `- Lint: ${v.lint.filter((l) => l.status === 'failed').length} of ${v.lint.length} failed.`,
        ]
      : []),
    ...(report.cleanInstall
      ? [`- Clean install: ${report.cleanInstall.passed ? 'passed' : 'FAILED'}.`]
      : []),
    '',
    '### Counts',
    '',
    `- Sites: ${sites('mechanical')} by rule, ${sites('agent')} by the agent, ${sites('manual')} manual.`,
    ...(lock
      ? [
          `- Lockfile: ${lock.outOfScope?.length ?? 0} outside the upgrade, ${lock.parentChurn?.length ?? 0} the parent commit already has, ${lock.transitive?.reduce((n, m) => n + m.changes.length, 0) ?? 0} transitive.`,
        ]
      : []),
    `- Changed files: ${report.changedFiles?.length ?? 0}. Decisions for you: ${(report.decisions?.length ?? 0) + (report.headline?.decision?.length ?? 0)}. Run notes: ${report.notes.length}.`,
    '',
    `Branch: \`${report.branch}\`${report.head ? ` · Verified commit: \`${report.head}\`` : ''}`,
    '',
  ].join('\n');
}
/** Readers of a shared report may not have Uptide installed. */
const withCommand = (text: string): string =>
  text.replace(/\b(?:npx )?uptide(?:@[\w.-]+)?(?= [a-z-])/g, UPTIDE_COMMAND);

export function renderMigration(
  report: FixReport,
  mode: 'full' | 'compact' = 'full',
  budget?: number,
): string {
  report = { ...report, sites: uniqueSites(report.sites) };
  const from =
    report.from ??
    ([...new Set(report.sites.map((s) => s.finding.change.from))].join(', ') || 'unknown');
  const title =
    report.mode === 'pin'
      ? `## Pin the Stripe API version to ${report.apiVersion}`
      : `## Upgrade ${report.package} ${from} → ${report.target}`;
  const lines: (string | Piece)[] = [title, ''];
  // Never a silent switch: the executor that ran is the first thing said when it is not the SDK.
  if (report.llm.sdkMissing) lines.push(`> ⚠️ ${sdkFallbackNote(report.llm.sdkMissing)}`, '');
  // Why the mechanical path stopped and the agent led: the first thing a reviewer reads.
  if (report.agentFallback?.length)
    lines.push(
      `> ⚠️ **Agent-led draft.** The mechanical path stopped: ${report.agentFallback.join('; ')}`,
      '',
    );
  if (report.cleanInstall?.passed === false)
    lines.push(
      `> ❌ **This branch does not install.** \`${report.cleanInstall.command}\` failed in the fix clone: ${report.cleanInstall.output?.split('\n').find((l) => l.trim()) ?? 'no output'}`,
      '',
    );
  if (report.lockfile?.outOfScope?.length)
    lines.push(
      lockfileChanges(
        ['### Lockfile changes outside the upgrade: review', ''],
        report.lockfile.outOfScope,
        report,
      ),
      '',
    );
  if (report.lockfile?.parentChurn?.length)
    lines.push(
      lockfileChanges(
        [
          '### Lockfile churn the parent commit already has',
          '',
          'The same install changes these at the parent commit too, so they are not from the upgrade:',
          '',
        ],
        report.lockfile.parentChurn,
        report,
      ),
      '',
    );
  if (report.rootPins?.length)
    lines.push(
      must(
        [
          '### Root pins changed: review',
          '',
          'Review these root version pin changes before merging:',
          '',
          ...report.rootPins.map(
            (pin) =>
              `- ${pin.file} ${pin.path.map((key) => JSON.stringify(key)).join(' > ')}: ${pin.before} → ${pin.after} (${pin.name}@${pin.to}).`,
          ),
        ].join('\n'),
      ),
      '',
    );
  if (report.packWarning) lines.push(`> ⚠️ ${report.packWarning}`, '');
  // Broken before the upgrade: said first, so no reader takes the comparison for proof.
  const unhealthy = baselineHeadline(baselineHealthOf(report));
  if (mode === 'full' && unhealthy && !report.verificationPending)
    lines.push(`> ⚠️ ${sentenceCase(unhealthy)}.`, '');
  if (report.headline) lines.push(`> **Decision for you:** ${report.headline.line}`, '');
  if (mode === 'full' && report.mode === 'pin') {
    const manual = report.sites.filter((s) => s.outcome === 'manual').length;
    lines.push(
      `**${report.verification.passed && !manual ? 'Ready for review.' : 'Review required before merging.'}** stripe stays at ${report.target}; each client created without \`apiVersion\` now says \`${report.apiVersion}\`, the version that SDK already defaults to. No behaviour change.${manual ? ` ${manual} client${manual === 1 ? '' : 's'} build${manual === 1 ? 's' : ''} options elsewhere and need${manual === 1 ? 's' : ''} the pin by hand.` : ''}`,
      '',
    );
  } else if (mode === 'full') {
    const bs = schemas(report),
      inputs = bs.filter((b) => !unchecked(b) && !differs(b)).reduce((n, b) => n + b.inputs, 0);
    const ready =
      report.verification.passed &&
      !report.headline &&
      !noPackBlockers(report).length &&
      migrationRisk(report).level !== 'High' &&
      !report.sites.some((s) => s.outcome === 'manual') &&
      !bs.some(differs) &&
      !(
        report.package === 'stripe' &&
        groups(report).some((g) => ['api-version', 'subscription-period'].includes(g.rule)) &&
        !additiveBumpOnly(report)
      );
    // A run under a shared configuration answers for the workspaces it covers, not for `.`.
    const workspaces = [
      ...new Set(report.verification.tests.flatMap((t) => t.covers ?? [t.workspace])),
    ]
      .filter((w) => w !== '.')
      .map((w) => `\`${basename(w)}\``);
    const typeVerdict = report.verification.newErrors.length
      ? 'New type errors remain.'
      : report.verification.after.length
        ? 'No new type errors; pre-existing errors remain.'
        : inputs
          ? `Types compile, and the checked schemas behave the same as before on ${inputs.toLocaleString('en-US')} sampled inputs.`
          : additiveBumpOnly(report)
            ? 'Types compile.'
            : !report.sites.length && migrationRisk(report).level === 'Low'
              ? 'Types compile and the tests pass.'
              : 'Types compile; runtime behavior needs review.';
    const what =
      report.sites.length || hasFeedbackEdits(report)
        ? `The code was migrated to ${report.package} ${from.split('.')[0] === report.target.split('.')[0] ? report.target : report.target.split('.')[0]}${workspaces.length ? ` in ${listed(workspaces)}` : ''}.`
        : 'No code changes were needed; only versions and the lockfile changed.';
    lines.push(
      `**${ready ? 'Ready for review.' : 'Review required before merging.'}** ${what} ${typeVerdict}${report.apiChanges ? ` ${sentenceCase(apiChangeSummary(report.apiChanges))} between ${report.apiChanges.from} and ${report.apiChanges.to}.` : ''}`,
      '',
    );
  }
  // What moved with the package: one install at versions that agree, never the package alone.
  const released = report.companions?.filter((c) => !c.required) ?? [];
  const required = report.companions?.filter((c) => c.required) ?? [];
  if (released.length)
    lines.push(
      `Upgraded with ${report.package}, so the install stays consistent:`,
      '',
      ...released.map((c) => `- \`${c.name}\` ${c.from} → ${c.to} (${c.reason})`),
      '',
    );
  const own = report.companions?.filter((c) => c.migration === 'own') ?? [];
  if (own.length)
    lines.push(
      must(
        [
          '### Needs its own migration',
          '',
          ...own.map(
            (c) =>
              `- \`${c.name}\` ${c.from} → ${c.to} is a major upgrade with no migration pack: only its version moved here. Its own breaking changes were not migrated; review them before merging.`,
          ),
        ].join('\n'),
      ),
      '',
    );
  if (required.length)
    lines.push(
      'Moved because the new version requires it:',
      '',
      ...required.map((c) => `- \`${c.name}\` ${c.from} → ${c.to} (moved because ${c.reason})`),
      '',
    );
  if (report.companionBlockers?.length)
    lines.push(
      'Blocked: a required move only a new major makes, which Uptide never makes:',
      '',
      ...report.companionBlockers.map((b) => `- ${b}`),
      '',
    );
  if (report.companionRemovals?.length)
    lines.push(
      'Removed:',
      '',
      ...report.companionRemovals.map((r) => `- \`${r.name}\`, ${r.reason}`),
      '',
    );
  if (report.companionStays?.length)
    lines.push(
      'Left where they are (not released with it):',
      '',
      ...report.companionStays.map((s) => `- ${s.replace(/^(\S+)/, '`$1`')}`),
      '',
    );
  // The note vouches for agent edits; with none, it has nothing to say.
  if (report.tier === 'generic' && report.sites.some((s) => s.outcome === 'agent'))
    lines.push(`> ${GENERIC_NOTE(report.package)}`, '');
  if (report.llm.disabled) lines.push('Assisted fixes disabled (--no-llm).', '');
  lines.push(...summaryRows(report), '');
  if (mode === 'full' && budget !== undefined && report.package === 'stripe') {
    for (const stored of report.reviewSections ?? []) {
      if (stored.title !== 'Stripe API changelog') continue;
      const section = stripeChangelog(withLists(stored, report), report);
      // Evidence stays visible and rank zero; only resource overlap can yield to the budget.
      lines.push('### Stripe API changelog', '', ...section.lines, '');
      const label = 'Other changes to resources you use (no code evidence)';
      lines.push(
        {
          kind: 'text',
          rank: 6,
          text: collapse(label, [
            section.summary,
            '',
            ...(section.lists ?? []).flatMap((list) => [
              `**${list.summary}**`,
              '',
              ...list.items,
              '',
            ]),
          ]).join('\n'),
          alt: collapse(label, [section.omitted]).join('\n'),
        },
        '',
      );
    }
  }

  if (report.lockfile?.eresolveRetry)
    lines.push(
      '',
      '### Lockfile re-resolved',
      '',
      `${describeEresolveRetry(report.lockfile.eresolveRetry)}.`,
    );
  if (report.lockfile?.peerReresolved?.length) {
    lines.push(
      '',
      '### Re-resolved because a peer changed',
      '',
      ...report.lockfile.peerReresolved.map(
        (p) =>
          `- \`${cell(p.name)}\` ${cell(p.from)} → ${cell(p.to)}; peers on ${p.peers.map((name) => `\`${cell(name)}\``).join(', ')}. Existing ranges: ${Object.entries(
            p.ranges,
          )
            .map(([source, range]) => `\`${cell(source)}: ${cell(range)}\``)
            .join(', ')}.`,
      ),
    );
  }
  // Lockfile entries outside the moved packages' names, each under the package that moved it.
  const transitive = report.lockfile?.transitive;
  if (mode === 'full' && transitive?.length) {
    const label = `Moved with the upgraded packages · ${count(
      transitive.reduce((n, m) => n + m.changes.length, 0),
      'transitive change',
    )}`;
    lines.push(
      droppable(
        7,
        collapse(label, [
          'Inside the upgraded packages’ own dependency subtrees; every other resolution is unchanged.',
          '',
          ...transitive.map(
            (m) =>
              `- \`${cell(m.name)}\` ${cell(m.from.join(', ') || 'none')} → ${cell(m.to.join(', ') || 'none')} ${m.changes.map((c) => cell(describeTransitive(c))).join('; ')}.`,
          ),
        ]),
        label,
      ),
      '',
    );
  }
  const housekeeping = report.lockfile?.housekeeping;
  if (mode === 'full' && housekeeping) {
    const label = `Lockfile housekeeping · ${count(housekeeping.deduped.length, 'dedupe move')} · ${count(housekeeping.metadata.length, 'metadata-only change')}`;
    lines.push(
      droppable(
        7,
        collapse(label, [
          'Outside resolutions retain the same package name, version and integrity; execution and platform fields are unchanged.',
          '',
          ...housekeeping.deduped.map(
            (d) =>
              `- \`${cell(d.name)}@${cell(d.version)}\`: \`${cell(d.from)}\` → \`${cell(d.to)}\`.`,
          ),
          ...housekeeping.metadata.map((key) => `- Metadata only: \`${cell(key)}\`.`),
        ]),
        label,
      ),
      '',
    );
  }
  if (groups(report).length) lines.push('### What changed', '');
  groups(report).forEach((g, i) => {
    lines.push(heading(g, report, i));
    if (mode === 'compact') return;
    const d = description(g, report);
    lines.push(d.summary);
    const representative =
      g.edits.find(
        (s) => g.rule === 'error-params' && /Field 'email' is required/.test(s.diff ?? ''),
      ) ??
      g.edits.find((s) => s.diff || s.attempts?.some((a) => a.outcome === 'accepted' && a.diff));
    const diff =
      representative?.diff ??
      representative?.attempts?.findLast((a) => a.outcome === 'accepted')?.diff;
    const files = new Map<string, number>();
    for (const s of g.sites) {
      files.set(s.finding.usage.file, (files.get(s.finding.usage.file) ?? 0) + 1);
      for (const file of s.editedFiles ?? []) if (!files.has(file)) files.set(file, 0);
    }
    const detail = [
      ...(diff
        ? ['```diff', diff.trim(), '```']
        : ['Representative diff was not retained in this stored run.']),
      ...(d.note ? ['', d.note] : []),
      '',
      ...[...files].map(([f, n]) => `- \`${f}\`${n ? ` (${n})` : ' (supporting edit)'}`),
    ];
    for (const s of g.edits) {
      const attempts = s.attempts ?? [];
      for (const a of attempts) {
        if (a.diff && (s !== representative || a.outcome !== 'accepted'))
          detail.push('', '```diff', a.diff.trim(), '```');
        detail.push(
          '',
          `**${s.finding.usage.file}:${s.finding.usage.line} · attempt ${a.attempt} (${a.outcome})**`,
          '',
          a.explanation.replace(/([^\n])\n(?=\d+\. |[-*] )/g, '$1\n\n'),
          '',
          `Diagnostics: ${a.before.length} → ${a.after.length}.`,
        );
      }
      if (!attempts.length && g.outcome === 'manual') detail.push('', s.reason);
    }
    const label = g.outcome === 'mechanical' ? 'Example and files' : 'Diff and reasoning';
    // Keep the representative diff even when the many-file/attempt history cannot fit.
    const piece = droppable(
      3,
      collapse(label, detail),
      `${label}: file list and additional attempts`,
    );
    if (piece.kind === 'text')
      piece.alt = collapse(label, [
        ...(diff
          ? ['```diff', diff.trim(), '```']
          : ['Representative diff was not retained in this stored run.']),
        ...(d.note ? ['', d.note] : []),
        '',
        piece.alt ?? '',
      ]).join('\n');
    lines.push(piece, '');
  });
  if (report.peerConflicts?.length)
    lines.push(
      must(
        [
          '### Peer risks',
          '',
          ...groupPeerBlockers(report.peerConflicts).map(
            (p) =>
              `- ${peerDescription(p)}. ${p.allowed ? 'Explicitly allowed with `--allow-peer`; the manager override is in package.json.' : 'Not overridden; the package manager may warn.'} Runtime compatibility needs review.`,
          ),
        ].join('\n'),
      ),
      '',
    );
  if (report.llm.feedback) {
    const { roundsUsed, maxRounds, maxCostUsd } = report.llm.feedback;
    lines.push(
      '',
      `Feedback rounds: ${roundsUsed}/${maxRounds}. Spend: $${report.llm.costUsd.toFixed(2)} / $${maxCostUsd.toFixed(2)} cap${report.llm.unreportedCostUsd ? `; $${report.llm.unreportedCostUsd.toFixed(2)} additionally reserved (usage unknown)` : ''}.`,
    );
  }
  const changedTests = (report.changedFiles ?? []).filter(isTestFile);
  if (changedTests.length)
    lines.push(
      '',
      '**Tests changed: review**',
      '',
      ...changedTests.map((file) => {
        const agent = (report.llm.tasks ?? [])
          .filter((task) => task.gate === 'accepted' && task.diffs?.[file])
          .flatMap((task) => task.summary?.changed ?? [])
          .filter((change) => change.file === file)
          .map((change) => change.what);
        const sites = report.sites
          .filter(
            (site) =>
              site.outcome !== 'manual' &&
              (site.finding.usage.file === file || site.editedFiles?.includes(file)),
          )
          .map((site) => site.reason);
        return `- ${file}: ${[...new Set([...agent, ...sites])].join('; ') || 'No explanation retained; review this test change before merging.'}`;
      }),
    );
  if (mode === 'compact')
    return `${lines
      .filter((l): l is string => typeof l === 'string')
      .join('\n')
      .trimEnd()}\n`;
  const review: (string | Piece)[] = [];
  const notChecked = schemas(report).filter(unchecked);
  if (notChecked.length)
    review.push(
      `- ${listed(notChecked.map((b) => `\`${b.schema}\``))}: behavior not checked${notChecked.every((b) => b.skipped?.includes('runtime import')) ? ' (they import another schema file)' : ''}.`,
    );
  for (const b of schemas(report).filter(differs)) {
    for (const d of b.differences)
      review.push(
        `- \`${b.schema}\`: ${d.kind}; minimal example \`${JSON.stringify(d.input)}\` → before \`${JSON.stringify(d.before)}\`, after \`${JSON.stringify(d.after)}\`.`,
      );
    for (const c of b.messageChecks?.filter((c) => c.status === 'different') ?? [])
      review.push(
        `- \`${b.schema}\`: ${c.input} at \`${c.path.join('.') || '(root)'}\`; message ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}.`,
      );
    if (!b.differences.length && !b.messageChecks?.some((c) => c.status === 'different'))
      review.push(
        `- \`${b.schema}\`: ${b.inputs - b.identical} sampled inputs differ; no example was retained.`,
      );
  }
  if (report.package === 'stripe' && !report.behavior)
    review.push(
      // With nothing in the changelog touching the code, what remains is outside the code.
      additiveBumpOnly(report)
        ? "- Check the webhook endpoint's API version in the Stripe Dashboard before deploying."
        : '- Runtime behavior was not checked; smoke-test billing and webhook responses against the target API version.',
    );
  if (
    !report.verification.tests.length ||
    report.verification.tests.some((t) => t.status === 'missing')
  )
    review.push(
      `- ${report.verification.tests.every((t) => t.status === 'missing') ? 'No tests ran.' : 'Some workspaces have no tests.'} ${report.package === 'zod' ? `Smoke-test the routes ${scopeList(report) ? `behind ${scopeList(report)}` : 'that use the changed schemas'} before merging.` : report.package === 'stripe' ? 'Add coverage for the changed billing and webhook flows before merging.' : 'Exercise the changed code by hand before merging.'}`,
    );
  for (const t of report.verification.tests.filter((t) => ['failed', 'timeout'].includes(t.status)))
    review.push(
      t.preexisting
        ? `- Tests in \`${basename(t.workspace)}\` were failing before this change (${t.preexisting[0] === '*' ? 'the whole run' : t.preexisting.map((f) => `\`${basename(f)}\``).join(', ')}); not caused here, but a green suite would verify more.`
        : `- Tests in \`${basename(t.workspace)}\` ${t.status}; fix or rerun before merging.`,
    );
  for (const t of report.verification.tests.filter((t) => t.notRun && t.notRun.files > 0))
    review.push(
      `- ${count(t.notRun?.files ?? 0, 'integration test file')} not run (need ${t.notRun?.needs.join('/')}). Run with \`--with-services\` to include them.`,
    );
  for (const l of (report.verification.lint ?? []).filter((l) => l.status === 'failed'))
    review.push(
      `- The repository's lint (${l.tool}) fails on the edited files; fix it before merging (see verification details).`,
    );
  if (report.llm.unreportedCostUsd)
    review.push(
      `- Unreported API usage: $${report.llm.unreportedCostUsd.toFixed(2)} reserved against the budget (actual spend unknown).`,
    );
  if (report.llm.costLimit)
    review.push(
      `- The agent ${costStopMessage(report.llm.costLimit, report.llm.estimate).replace(/--max-cost [\d.]+|maxCost(?= in)/, '`$&`')}`,
    );
  const manual = report.sites.filter((s) => s.outcome === 'manual');
  if (manual.length) review.push(manualSites(manual, report));
  if (report.verification.newErrors.length)
    review.push(
      `- Resolve ${report.verification.newErrors.length} new type errors before merging (see verification details).`,
    );
  if (
    !report.verification.passed &&
    !report.verification.newErrors.length &&
    !report.verification.tests.some((t) => ['failed', 'timeout'].includes(t.status))
  )
    review.push('- Verification is incomplete; resolve the recorded run notes before merging.');
  if (review.length) lines.push('### Worth a look', '', ...review, '');
  const decisions: string[] = [];
  // Runs stored before the pack owned these decisions carry none: they are said here, once.
  if (
    report.package === 'stripe' &&
    groups(report).some((g) => g.rule === 'subscription-period') &&
    !(report.decisions ?? []).some((d) => /billing period now comes from one item/.test(d))
  )
    decisions.push(
      "- Confirm the latest-ending item is the desired billing rule: items ending `[100, 200]` → that item's `{ start, end }`; a single item is unchanged.",
      '- Confirm what no items means (Stripe never returns that): the webhook keeps fetching the full subscription, API routes throw "subscription has no items". Check pagination: only returned `items.data` are considered.',
    );
  if (
    report.package === 'stripe' &&
    groups(report).some((g) => g.rule === 'api-version') &&
    !additiveBumpOnly(report)
  )
    decisions.push(
      '- Coordinate the API-version rollout with dashboard webhook endpoints and other services.',
    );
  decisions.push(
    ...(report.headline?.decision ?? []),
    ...agentDecisionLines(report),
    ...(report.decisions ?? []),
  );
  if (decisions.length) lines.push('### Decisions for you', '', ...decisions, '');
  lines.push(
    '<details><summary>Verification details</summary>',
    '',
    ...verificationDetails(report, budget !== undefined),
    '',
    '</details>',
    '',
    ...collapse('Run details', [
      `Uptide ${report.uptideVersion ?? 'version not retained'} · ${report.llm.disabled ? 'agent disabled (--no-llm)' : (report.llm.model ?? 'agent unavailable')} · ${(report.llm.inputTokens / 1000).toFixed(1)}k/${(report.llm.outputTokens / 1000).toFixed(1)}k tokens · $${report.llm.costUsd.toFixed(2)} · ${Math.round(report.timingMs / 60_000)} min`,
      ...(report.phases?.length ? [`Phases: ${describePhases(report.phases)}`] : []),
      '',
      `Uptide commit: \`${report.uptideCommit ?? 'not retained'}\`${report.uptideDirty ? ' (working-tree changes)' : ''}`,
      `Branch: \`${report.branch}\``,
      ...(report.base ? [`Started from: \`${report.base}\``] : []),
      ...(report.baseHead ? [`Starting commit: \`${report.baseHead}\``] : []),
      ...(report.tier
        ? [
            `Tier: ${report.packWarning ? 'candidate' : report.tier} (${report.tier === 'verified' ? 'a migration pack covers this upgrade' : 'no migration pack: nothing analyzed the upgrade; only the checks under Verified by vouch for it'})`,
          ]
        : []),
      ...(report.verifiedAt
        ? [
            `Verified at: ${report.verifiedAt}${report.verificationTimingMs === undefined ? '' : ` · ${(report.verificationTimingMs / 1000).toFixed(2)}s`}`,
          ]
        : []),
      ...(report.head ? [`Verified commit: \`${report.head}\``] : []),
      ...(report.verifiedTree ? [`Verified tree: \`${report.verifiedTree}\``] : []),
    ]),
    '',
  );
  // Normalize retained commands before measuring the body.
  const body = fitPieces(
    lines.map((part): Piece => {
      const piece = typeof part === 'string' ? must(part) : part;
      return piece.kind === 'text'
        ? {
            ...piece,
            text: withCommand(piece.text),
            ...(piece.alt === undefined ? {} : { alt: withCommand(piece.alt) }),
          }
        : {
            ...piece,
            open: withCommand(piece.open),
            close: withCommand(piece.close),
            items: piece.items.map(withCommand),
            more: withCommand(piece.more),
          };
    }),
    budget,
  );
  return body ?? minimalBody(report, title);
}
/** ` (needs DATABASE_URL; set verify.build)` when every failed build stopped before the framework's build. */
function buildCauseText(build: NonNullable<FixReport['verification']['build']>): string {
  const failed = build.filter((b) => b.status === 'failed' || b.status === 'timeout');
  const causes = [...new Set(failed.map((b) => b.cause))];
  return causes.length === 1 && causes[0] ? ` (build ${causes[0]}; set verify.build)` : '';
}
function verificationDetails(report: FixReport, bounded: boolean): (string | Piece)[] {
  const v = report.verification;
  const bs = schemas(report);
  const checks = bs.flatMap((b) => b.messageChecks ?? []).filter((c) => c.status !== 'default');
  const lines: (string | Piece)[] = [
    `Type errors: baseline ${v.baseline.length}; target ${v.target.length}; after ${v.after.length}; ${v.newErrors.length} new. Verification: ${v.passed ? 'PASS' : 'FAIL'}.${v.typesUnverified ? ` Types not verified (type resolution failed): ${v.typesUnverified}.` : ''}`,
    ...(v.build
      ? [
          '',
          ...v.build.map((b) =>
            b.command
              ? `Build ${b.phase === 'baseline' ? 'before the baseline' : 'after the bump'} in \`${b.workspace}\`${b.script ? ` (\`${b.script}\` script)` : ''}: \`${b.command}\` — ${b.status === 'timeout' ? 'timed out' : b.status}${b.cause ? `: the build ${b.cause} before the framework build started. Set \`verify.build\` in uptide.yml to a script that builds without it (\`build-ci\`).` : ''}`
              : `Build ${b.phase === 'baseline' ? 'before the baseline' : 'after the bump'} in \`${b.workspace}\`: ${b.output === 'no build script' ? 'no build script' : b.output}`,
          ),
        ]
      : []),
    ...(report.generated?.length
      ? [
          '',
          ...report.generated.map(
            (g) =>
              `Generated ${g.phase === 'bump' ? 'after the bump' : 'before the baseline'}: \`${g.command}\` in \`${g.workspace}\` — ${g.status === 'generated' ? 'ok' : `${g.status}: ${(g.output ?? '').split('\n').filter(Boolean).at(-1) ?? ''}`}`,
          ),
        ]
      : []),
    '',
    '| Workspace | Baseline tests | Target tests |',
    '|---|---|---|',
    ...v.tests.map(
      (t) =>
        `| ${cell(t.workspace)} | ${v.baselineTests.find((b) => b.workspace === t.workspace)?.status ?? 'not run'} | ${t.status} |`,
    ),
    // What ran: the command, how its scope was chosen and which workspaces it answers for.
    ...(v.tests.some((t) => t.scope)
      ? [
          '',
          ...v.tests
            .filter((t) => t.scope)
            .map(
              (t) =>
                `- \`${t.workspace}\`: ${t.scope}${t.covers && t.covers.join() !== t.workspace ? `, covering ${t.covers.map((w) => `\`${w}\``).join(', ')}` : ''}${t.command ? ` — \`${t.command}\`` : ''}${t.summary ? ` — ${t.summary} passed` : ''}${t.retried?.length ? ` — failed once outside the affected files and passed on rerun: ${t.retried.map((f) => `\`${f}\``).join(', ')}` : ''}${t.notRun?.files ? ` — ${count(t.notRun.files, 'integration test file')} not run (need ${t.notRun.needs.join('/')})` : ''}${t.services ? ` — ran against ${t.services.names.join(', ')}${t.services.targets.length ? ` (${t.services.targets.join('; ')})` : ''}` : ''}`,
            ),
        ]
      : []),
    // A related-tests run that failed and was replaced by the repository's own suite: the
    // command that failed and what it printed, before and after the change alike.
    ...[
      ...v.baselineTests.map((t) => ['before the change', t] as const),
      ...v.tests.map((t) => ['after the change', t] as const),
    ]
      .filter(([, t]) => t.fallback)
      .flatMap(([when, t]) => [
        '',
        `\`${t.workspace}\` ${when}: \`${t.fallback?.command}\` ${t.fallback?.reason === 'no-related' ? 'found no test related to the affected files' : 'failed before running a test'}, so \`${t.fallback?.ranInstead}\` ran instead and its result is the one above.`,
        droppable(
          2,
          ['```text', testOutput(t.fallback?.output || '(no output)'), '```'],
          `Related-tests output (${t.workspace}, ${when})`,
        ),
      ]),
  ];
  if (v.formatted?.length)
    lines.push(
      '',
      `Formatted with ${v.formatted.join(', ')}: only the files this migration edited, in their own commit.`,
    );
  for (const l of v.lint ?? []) {
    lines.push(
      '',
      `Lint (${l.tool}) on ${count(l.files, 'edited file')}: ${l.status === 'passed' ? 'passed' : l.status === 'pre-existing' ? 'fails, and failed on the same files before the migration' : 'FAILED'} — \`${l.command}\``,
    );
    if (l.status !== 'passed' && l.output)
      lines.push(droppable(2, ['```text', l.output.trim(), '```'], `Lint output (${l.tool})`));
  }
  const listing = (d: FixDiagnostic): string => `- ${d.file}:${d.line} TS${d.code}: ${d.message}`;
  // What was broken before is one line of counts; the first few are there to look at.
  if (v.baseline.length) {
    const shown = v.baseline.slice(0, 10).map(listing);
    const rest = v.baseline.length - shown.length;
    lines.push(
      '',
      `**${errorSummary(v.baseline, 'pre-existing error')}**`,
      droppable(
        4,
        collapse(rest ? `First 10 of ${v.baseline.length}` : 'List', [
          ...shown,
          ...(rest ? [`- … and ${rest} more`] : []),
        ]),
        'Pre-existing error list',
      ),
    );
  }
  // What the migration left broken is never dropped: at most cut to its first entries.
  if (v.newErrors.length)
    lines.push(
      '',
      '**Remaining errors**',
      shortened(v.newErrors.map(listing), [
        ...v.newErrors.slice(0, FIRST).map(listing),
        ...(v.newErrors.length > FIRST
          ? [`- … and ${v.newErrors.length - FIRST} more, all in ${fullLists(report)}.`]
          : []),
      ]),
    );
  if (v.workspaceTypes?.length)
    lines.push(
      '',
      '| Workspace | Type errors after verification |',
      '|---|---|',
      ...v.workspaceTypes.map((w) => `| ${cell(w.workspace)} | ${w.errors} |`),
    );
  if (report.behavior)
    lines.push(
      '',
      `Samples: ${bs.reduce((n, b) => n + b.identical, 0).toLocaleString('en-US')}/${bs.reduce((n, b) => n + b.inputs, 0).toLocaleString('en-US')} identical across ${bs.length} schemas. Custom-message assertions: ${checks.filter((c) => c.status === 'identical').length}/${checks.length} identical.`,
      '',
      'Fixed seed 1729; up to 200 v3-derived inputs per schema. Isolated schema declarations and dependencies; no application code executed. Sampled equivalence is not a proof; examples are greedily minimized.',
      '',
      '| Schema | Inputs | Identical | Valid v3 inputs | Differences / limits |',
      '|---|---|---|---|---|',
      ...report.behavior.map(
        (b) =>
          `| ${cell(`${b.file}: ${b.schema}`)} | ${b.inputs} | ${b.identical} | ${b.validInputs} | ${cell(b.skipped ?? `${b.differences.length}${b.schemaKind === 'object' && b.validInputs < 20 ? '; fewer than 20 valid inputs' : ''}`)} |`,
      ),
    );
  for (const b of report.behavior ?? []) {
    if (b.differences.length)
      lines.push(
        '',
        `**${b.file}: ${b.schema} differences**`,
        '```json',
        JSON.stringify(b.differences, null, 2),
        '```',
      );
    if (b.messageChecks?.length)
      lines.push(
        '',
        `**${b.file}: ${b.schema} custom messages**`,
        ...b.messageChecks.map(
          (c) =>
            `- ${c.site}, ${c.input} ${c.path.join('.') || '(root)'}: ${c.status} — ${c.before ? `${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}` : (c.reason ?? '')}`,
        ),
      );
  }
  for (const t of v.tests)
    if (t.status !== 'missing' && t.output)
      lines.push(
        '',
        `**Tests: ${t.workspace}**`,
        droppable(2, ['```text', testOutput(t.output), '```'], `Test output (${t.status})`),
      );
  for (const b of v.build ?? [])
    if ((b.status === 'failed' || b.status === 'timeout') && b.output) {
      const preexisting = v.baselineBuild?.some(
        (p) =>
          p.workspace === b.workspace &&
          p.command === b.command &&
          (p.status === 'failed' || p.status === 'timeout'),
      );
      lines.push(
        '',
        `**Build: ${b.workspace}${preexisting ? ' (failed at the parent; not iterated)' : ''}**`,
        droppable(2, ['```text', testOutput(b.output), '```'], `Build output (${b.status})`),
      );
    }
  const feedbackTasks = (report.llm.tasks ?? []).filter((task) =>
    task.id.startsWith('verification-'),
  );
  if (feedbackTasks.length) {
    lines.push(
      '',
      '**After verification feedback**',
      '',
      `By rule: ${report.sites.filter((s) => s.outcome === 'mechanical').length} sites. By the agent before feedback: ${report.sites.filter((s) => s.outcome === 'agent').length} sites.`,
      ...feedbackTasks.map(
        (task) =>
          `- Round ${task.id.replace('verification-', '')}: ${task.gate}${task.rejection ? ` — ${task.rejection}` : ''}${task.stop ? ` — ${task.stop}` : ''}. ${Object.keys(task.diffs ?? {}).join(', ') || 'No accepted edits.'}`,
      ),
      ...feedbackTasks.flatMap((task) =>
        task.gate === 'accepted'
          ? (task.summary?.changed ?? []).map((change) => `- ${change.file}: ${change.what}`)
          : [],
      ),
      `Remaining: ${v.newErrors.length} new type errors; ${v.tests.filter((t) => t.status === 'failed' || t.status === 'timeout').length} failing or timed-out test runs; ${(v.build ?? []).filter((b) => b.status !== 'passed').length} unsuccessful builds.`,
    );
  }
  // What happened to the publish step is the terminal's news, not the description's.
  const agentEdits = report.sites.some((s) => s.outcome === 'agent');
  const notes = report.notes.filter(
    (n) =>
      !/^(?:Publication plan printed|PR not opened:)/.test(n) &&
      (agentEdits || n !== GENERIC_NOTE(report.package)),
  );
  if (notes.length) lines.push('', '**Run notes**', '', ...notes.map((n) => `- ${n}`));
  for (const stored of report.reviewSections ?? []) {
    // Decisions are rendered once, in their own section above.
    if (stored.title === 'Decisions for you') continue;
    if (bounded && report.package === 'stripe' && stored.title === 'Stripe API changelog') continue;
    const section = withLists(stored, report);
    lines.push('', `**${section.title}**`, '', ...section.lines);
    // Long lists (a provider's changelog) give way from their end, in the order given.
    (section.lists ?? []).forEach((list) => {
      lines.push('', {
        kind: 'list',
        open: `<details>\n<summary>${list.summary}</summary>\n`,
        close: '\n</details>',
        items: list.items,
        rank: 6,
        more: list.more.includes('report.json')
          ? list.more
          : `${list.more} Full text is retained in report.json.`,
      });
    });
  }
  return lines;
}
/**
 * Runs stored before sections had lists wrote their collapsed blocks into `lines`
 * (`<details>`, `<summary>`, one `- ` line per entry, `</details>`). Those blocks are read
 * back as lists, so an old run's description fits the limit like a new one's.
 */
function withLists(section: ReviewSection, report: FixReport): ReviewSection {
  if (section.lists || !section.lines.includes('<details>')) return section;
  const lines: string[] = [];
  const lists: NonNullable<ReviewSection['lists']> = [];
  for (let i = 0; i < section.lines.length; i++) {
    const line = section.lines[i] as string;
    if (line !== '<details>') {
      lines.push(line);
      continue;
    }
    const end = section.lines.indexOf('</details>', i);
    const block = end < 0 ? [] : section.lines.slice(i + 1, end);
    const summary = /^<summary>(.*)<\/summary>$/.exec(block[0] ?? '')?.[1];
    const items = block.slice(1).filter((l) => l.trim() !== '');
    if (end < 0 || summary === undefined || !items.every((l) => l.startsWith('- '))) {
      lines.push(line);
      continue;
    }
    lists.push({
      summary,
      items,
      more: /Stripe/.test(section.title)
        ? `- … {n} more not shown here: [Stripe's changelog](https://docs.stripe.com/changelog)${report.apiChanges ? `, ${report.apiChanges.from} → ${report.apiChanges.to}` : ''}.`
        : "- … {n} more not shown here: this description is at GitHub's size limit.",
    });
    i = end;
  }
  while (lines.at(-1) === '') lines.pop();
  return { ...section, lines, lists };
}
/** `analyze 12s · baseline 31s · agent 1m 04s $0.42`: wall time per phase, and spend where there was any. */
export function describePhases(phases: FixPhase[]): string {
  const time = (ms: number) => {
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  };
  return phases
    .map((p) => `${p.name} ${time(p.ms)}${p.costUsd ? ` $${p.costUsd.toFixed(2)}` : ''}`)
    .join(' · ');
}
/** The PR description: everything that fits GitHub's limit, in the order that matters. */
export const prBody = (report: FixReport): string =>
  renderMigration(report, 'full', PR_BODY_BUDGET);
/** The whole report, nothing left out: what the migration page is rendered from. */
export const migrationBody = (report: FixReport): string => renderMigration(report, 'full');
export const formatFix = (report: FixReport): string => renderMigration(report, 'compact');

/** Small representative before/after patch retained with a mechanical edit. */
export function editDiff(before: string, after: string): string {
  const a = before.split('\n'),
    b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length,
    endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return [
    ...a.slice(start, endA).map((s) => `- ${s.trim()}`),
    ...b.slice(start, endB).map((s) => `+ ${s.trim()}`),
  ].join('\n');
}
