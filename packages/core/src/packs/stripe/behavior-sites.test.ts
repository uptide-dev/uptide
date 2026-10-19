import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Finding } from '../../domain/report.js';
import { stripeBehaviorPlan } from '../../fix/stripe-behavior.js';
import {
  applicable,
  recordDecisions,
  recordFindings,
  recordKept,
  recordProblems,
  recordPrompt,
  recordSites,
  sourceProblems,
} from '../records.js';
import { stripeBehaviorSites } from './behavior-sites.js';
import { stripePack, stripeRecords } from './index.js';
import { apiClients } from './relevance.js';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function fixture(code: string) {
  const root = mkdtempSync(join(tmpdir(), 'uptide-stripe-record-'));
  dirs.push(root);
  const put = (file: string, text: string) => writeFileSync(join(root, file), text);
  mkdirSync(join(root, 'node_modules/stripe/types/Checkout'), { recursive: true });
  put('package.json', JSON.stringify({ dependencies: { stripe: '18.5.0' } }));
  put(
    'tsconfig.json',
    JSON.stringify({
      compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', strict: true },
      include: ['*.ts'],
    }),
  );
  put(
    'node_modules/stripe/package.json',
    JSON.stringify({ name: 'stripe', version: '18.5.0', types: 'index.d.ts' }),
  );
  put(
    'node_modules/stripe/types/SubscriptionsResource.d.ts',
    `export interface SubscriptionCreateParams { customer?: string; billing_mode?: { type: 'classic' | 'flexible' }; } export class Subscriptions { create(params: SubscriptionCreateParams): void; update(id: string, params: SubscriptionCreateParams): void; }`,
  );
  put(
    'node_modules/stripe/types/Checkout/SessionsResource.d.ts',
    `export interface SubscriptionData { billing_mode?: { type: 'classic' | 'flexible' }; trial_period_days?: number; } export interface SessionCreateParams { mode?: 'subscription' | 'payment' | 'setup'; subscription_data?: SubscriptionData; } export class Sessions { create(params: SessionCreateParams): void; }`,
  );
  for (const name of ['Invoices', 'SubscriptionSchedules', 'Quotes', 'PaymentLinks']) {
    put(
      `node_modules/stripe/types/${name}Resource.d.ts`,
      `export class ${name} { ${name === 'Invoices' ? 'createPreview' : 'create'}(params: Record<string, any>, options?: {apiVersion?: string}): void; }`,
    );
  }
  put(
    'node_modules/stripe/index.d.ts',
    `import { Invoices } from './types/InvoicesResource'; import { SubscriptionSchedules } from './types/SubscriptionSchedulesResource'; import { Quotes } from './types/QuotesResource'; import { PaymentLinks } from './types/PaymentLinksResource'; import { Subscriptions } from './types/SubscriptionsResource'; import { Sessions } from './types/Checkout/SessionsResource'; export default class Stripe { constructor(key?: string, options?: {apiVersion?: string}); invoices: Invoices; subscriptionSchedules: SubscriptionSchedules; quotes: Quotes; paymentLinks: PaymentLinks; subscriptions: Subscriptions; checkout: { sessions: Sessions }; } export type { SubscriptionCreateParams } from './types/SubscriptionsResource'; export type { SessionCreateParams, SubscriptionData } from './types/Checkout/SessionsResource';`,
  );
  put(
    'code.ts',
    `import Stripe, { type SubscriptionCreateParams, type SessionCreateParams, type SubscriptionData } from 'stripe';\nconst stripe = new Stripe();\n${code}\n`,
  );
  return root;
}
const scan = (root: string, phase: 'before' | 'after' = 'before') =>
  recordSites(stripeRecords, { root, workspace: '.', phase });
describe('Stripe omitted billing mode', () => {
  it('pins quoted sources without vendoring pages; API versions refine the broad SDK range', () => {
    expect(recordProblems(stripeRecords, import.meta.dirname, 'stripe')).toEqual([]);
    expect(applicable(stripeRecords, '18.5.0', '22.6.2')).toHaveLength(1);
    expect(applicable(stripeRecords, '19.0.0', '22.6.2')).toHaveLength(1);
    expect(applicable(stripeRecords, '12.0.0', '22.6.2')).toHaveLength(1);
    expect(applicable(stripeRecords, '13.0.0', '22.6.2')).toHaveLength(1);
    expect(stripePack.supports('12.0.0', '19.0.0')).toBe(true);
    expect(stripePack.supports('13.0.0', '19.0.0')).toBe(true);
    expect(applicable(stripeRecords, '18.0.0', '18.5.0')).toHaveLength(0);
  });
  it('rejects full-page drift even when the quote survives, and rejects changed quotes', () => {
    const record = stripeRecords[0];
    const source = record?.sources[0];
    if (!record || !source) throw new Error('missing Stripe behavior source');
    expect(source.snapshot).toBeUndefined();
    expect(sourceProblems(source, source.quote)).toEqual([
      `${source.url} does not match its sha256`,
    ]);
    expect(sourceProblems(source, 'changed page')).toHaveLength(2);
    expect(
      recordProblems(
        [{ ...record, sources: [{ ...source, quote: '' }] }],
        import.meta.dirname,
        'stripe',
      ),
    ).toHaveLength(1);
  });
  it('finds direct calls, variables and builders; leaves explicit classic and flexible alone', () => {
    const root = fixture(`stripe.subscriptions.create({ customer: 'cus' });
const params = { customer: 'cus' }; stripe.subscriptions.create(params);
function build(): SubscriptionCreateParams { return { customer: 'cus' }; }
stripe.subscriptions.create(build());
stripe.subscriptions.create({ billing_mode: { type: 'classic' } });
stripe.subscriptions.create({ billing_mode: { type: 'flexible' } });
stripe.subscriptions.update('sub', { customer: 'cus' });
const fake = { subscriptions: { create(p: object) {} } }; fake.subscriptions.create({});`);
    expect(scan(root).map((s) => s.line)).toEqual([3, 4, 6]);
    expect(scan(root).every((s) => !s.decision)).toBe(true);
  });
  it('uses subscription_data for subscription Checkout, including a typed wrapper and builder', () => {
    const root = fixture(`stripe.checkout.sessions.create({ mode: 'subscription' });
stripe.checkout.sessions.create({ mode: 'subscription', subscription_data: {} });
const data: SubscriptionData = {};
function build(): SubscriptionData { return data; }
function open(params: SessionCreateParams) { stripe.checkout.sessions.create(params); }
open({ mode: 'subscription', subscription_data: build() });
stripe.checkout.sessions.create({ mode: 'payment' });
stripe.checkout.sessions.create({ mode: 'setup' });
function onlyLogs(params: SessionCreateParams) { console.log(params); }
onlyLogs({ mode: 'subscription' });
stripe.checkout.sessions.create({ mode: 'subscription', subscription_data: { billing_mode: { type: 'classic' } } });
stripe.checkout.sessions.create({ mode: 'subscription', subscription_data: { billing_mode: { type: 'flexible' } } });`);
    expect(scan(root).map((s) => s.line)).toEqual([3, 4, 5]);
  });
  it('unknown params or spreads become decisions, never edits; an explicit key overrides a spread', () => {
    const root = fixture(`declare const unknownParams: SubscriptionCreateParams;
stripe.subscriptions.create(unknownParams);
stripe.subscriptions.create({ ...unknownParams });
stripe.subscriptions.create({ ...unknownParams, billing_mode: { type: 'flexible' } });
const params: SubscriptionCreateParams = {}; if (Math.random()) params.billing_mode = { type: 'classic' }; stripe.subscriptions.create(params);`);
    const sites = scan(root);
    expect(sites).toHaveLength(3);
    expect(sites.every((s) => s.decision)).toBe(true);
    expect(recordPrompt(stripeRecords, sites).join('\n')).toContain('decision only; do not edit');
  });
  it('leaves straight-line explicit assignments alone, and ignores unrelated assignments', () => {
    const root = fixture(`const p: SubscriptionCreateParams = {};
p.billing_mode = { type: 'classic' };
stripe.subscriptions.create(p);
const data: SubscriptionData = {};
data.trial_period_days = 5;
stripe.checkout.sessions.create({ mode: 'subscription', subscription_data: data });`);
    expect(scan(root).map((s) => s.line)).toEqual([6]);
  });
  it('does not infer omission through a mutated builder return or an escaped alias', () => {
    const root = fixture(`function build(): SubscriptionCreateParams {
  const p: SubscriptionCreateParams = {};
  p.billing_mode = { type: 'flexible' };
  return p;
}
stripe.subscriptions.create(build());
const p: SubscriptionCreateParams = {};
const alias = p; alias.billing_mode = { type: 'flexible' };
stripe.subscriptions.create(p);`);
    expect(scan(root)).toHaveLength(1);
    expect(scan(root)[0]?.decision).toBe(true);
  });
  it('reports proven exact edits as Kept and unresolved sites as cited decisions', () => {
    const root = fixture("stripe.subscriptions.create({ billing_mode: { type: 'classic' } });");
    const sites = scan(root, 'after');
    expect(recordKept(stripeRecords, sites).join('\n')).toContain(
      '**Kept (stripe/billing-mode-default-flexible):**',
    );
    expect(recordKept(stripeRecords, sites).join('\n')).toContain(
      '[source](https://docs.stripe.com/',
    );
    expect(recordDecisions(stripeRecords, sites)).toEqual([]);
    const unknown = sites.map((s) => ({ ...s, kept: false, decision: true }));
    expect(recordKept(stripeRecords, unknown)).toEqual([]);
    expect(recordDecisions(stripeRecords, unknown).join('\n')).toContain('No automatic edit.');
  });
  it('reports unresolved Checkout subscription parameters as a decision when the checker proves mode', () => {
    const root = fixture(`declare const params: SessionCreateParams & { mode: 'subscription' };
stripe.checkout.sessions.create(params);`);
    expect(scan(root)).toHaveLength(1);
    expect(scan(root)[0]?.decision).toBe(true);
  });
  it.each([
    [
      'invoices.createPreview',
      'subscription_details: { items: [], BILLING }',
      'subscription_details.billing_mode',
    ],
    [
      'invoices.createPreview',
      'schedule_details: { phases: [], BILLING }',
      'schedule_details.billing_mode',
    ],
    ['subscriptionSchedules.create', "customer: 'cus', BILLING", 'billing_mode'],
    [
      'quotes.create',
      "line_items: [{price_data: {recurring: {interval: 'month'}}}], subscription_data: { BILLING }",
      'subscription_data.billing_mode',
    ],
  ])('%s resolves omitted, explicit and unknown parameters at %s', (method, template, edit) => {
    const omitted = template.replace('BILLING', '');
    const classic = template.replace('BILLING', "billing_mode: { type: 'classic' }");
    const flexible = template.replace('BILLING', "billing_mode: { type: 'flexible' }");
    const root = fixture(`stripe.${method}({ ${omitted} });
const params = { ${omitted} }; stripe.${method}(params);
stripe.${method}({ ${classic} });
stripe.${method}({ ${flexible} });
declare const unknown: Record<string, any>; stripe.${method}(unknown);`);
    const sites = scan(root);
    expect(sites).toHaveLength(3);
    expect(sites.slice(0, 2).every((s) => !s.decision && s.edit?.startsWith(edit))).toBe(true);
    expect(sites[2]?.decision).toBe(true);
    expect(scan(root, 'after').filter((s) => s.kept)).toHaveLength(1);
  });
  it('adds quote subscription_data only when an inline price proves recurrence', () => {
    const root =
      fixture(`stripe.quotes.create({line_items: [{price_data: {recurring: {interval: 'month'}}}]});
stripe.quotes.create({subscription_data: {}, line_items: [{price: 'price'}]});`);
    expect(scan(root).map((s) => s.decision)).toEqual([false, true]);
  });
  it('Payment Links requires a cited decision because the API has no preserving parameter', () => {
    const root =
      fixture(`stripe.paymentLinks.create({ line_items: [{ price: 'price', quantity: 1 }] });
const params = { subscription_data: {} }; stripe.paymentLinks.create(params);
declare const unknown: Record<string, any>; stripe.paymentLinks.create(unknown);`);
    expect(scan(root)).toHaveLength(3);
    expect(
      scan(root).every((s) => s.decision && s.decisionReason?.includes('no billing_mode')),
    ).toBe(true);
    expect(recordPrompt(stripeRecords, scan(root)).join('\n')).toContain(
      'decision only; do not edit',
    );
  });
  it('does not edit schedules migrated from subscriptions or previews of existing subscriptions', () => {
    const root = fixture(`stripe.subscriptionSchedules.create({ from_subscription: 'sub' });
stripe.invoices.createPreview({ subscription: 'sub', subscription_details: { items: [] } });
stripe.invoices.createPreview({ schedule: 'sched', schedule_details: { phases: [] } });
stripe.invoices.createPreview({ customer: 'cus' });
stripe.quotes.create({ line_items: [{price: 'price'}] });`);
    expect(scan(root)).toHaveLength(1);
    expect(scan(root)[0]?.decision).toBe(true);
  });
  it('adds quoted sites to the agent plan when a raw compiler finding moves the API pin', () => {
    const root = fixture(`const client = new Stripe('test', {apiVersion: '2025-08-27.basil'});
client.subscriptions.create({});`);
    const selected: Finding[] = [
      {
        change: {
          package: 'stripe',
          from: '18.5.0',
          to: '22.6.2',
          path: 'Stripe.LatestApiVersion',
          kind: 'type',
          severity: 'breaking',
          source: 'types',
          confidence: 1,
        },
        usage: {
          file: 'code.ts',
          line: 3,
          column: 1,
          endLine: 3,
          endColumn: 1,
          symbolPath: 'Stripe.LatestApiVersion',
          access: 'typeRef',
          snippet: 'apiVersion',
          via: 'direct',
        },
        severity: 'breaking',
        confidence: 1,
        fixability: 'assisted',
        reason: 'type incompatible',
      },
    ];
    expect(selected[0]?.rule).toBeUndefined();
    const context = {
      from: '18.5.0',
      to: '22.6.2',
      includeDeprecated: false,
      apiVersions: { from: '2025-08-27.basil', to: '2026-08-26.dahlia' },
      apiClients: apiClients(root, ['.']),
    };
    stripeBehaviorPlan(stripePack, context, selected, {
      root,
      workspaces: ['.'],
      from: context.from,
      to: context.to,
    });
    expect(selected).toHaveLength(2);
    expect(selected[1]?.rule).toBe('stripe/billing-mode-default-flexible');
    expect(selected[1]?.details?.join('\n')).toContain('Subscriptions you create through the API');
    const retained: Finding[] = [];
    stripeBehaviorPlan(
      stripePack,
      { ...context, payloadVersions: [{ file: 'code.ts', line: 3, value: '2026-08-26.dahlia' }] },
      retained,
      { root, workspaces: ['.'], from: context.from, to: context.to },
    );
    expect(retained).toEqual([]);
  });
  it('uses the receiver client pin, not payload versions or another client', () => {
    const root = fixture(`const old = new Stripe('test', { apiVersion: '2025-08-27.basil' });
const current = new Stripe('test', { apiVersion: '2025-09-30.clover' });
old.subscriptions.create({});
current.subscriptions.create({});
const payload = { api_version: '2025-09-30.clover' };
stripe.subscriptions.create({});`);
    expect(scan(root).map((s) => s.line)).toEqual([8]);
    const stripe = {
      apiVersions: { from: '2025-08-27.basil', to: '2025-09-30.clover' },
      apiClients: apiClients(root, ['.']),
      movingApiPins: [{ file: 'code.ts', line: 3 }],
    };
    expect(
      stripeBehaviorSites({ root, workspace: '.', phase: 'before', stripe }).map((s) => s.line),
    ).toEqual([5, 8]);
    // The planned pin migration was declined: it is unaffected after the session.
    expect(
      stripeBehaviorSites({ root, workspace: '.', phase: 'after', stripe })[0]?.unaffected,
    ).toBe(true);
    const code = `import Stripe from 'stripe';
const old = new Stripe('test', { apiVersion: '2025-09-30.clover' });
old.subscriptions.create({});`;
    const before = apiClients(root, ['.']).filter((c) => c.version === '2025-08-27.basil');
    writeFileSync(join(root, 'code.ts'), code);
    expect(
      stripeBehaviorSites({
        root,
        workspace: '.',
        phase: 'after',
        stripe: { ...stripe, apiClients: before },
      })[0]?.unaffected,
    ).toBe(false);
    writeFileSync(join(root, 'code.ts'), code.replace(", { apiVersion: '2025-09-30.clover' }", ''));
    expect(
      stripeBehaviorSites({
        root,
        workspace: '.',
        phase: 'after',
        stripe: { ...stripe, apiClients: before },
      })[0]?.unaffected,
    ).toBe(false);
  });
  it('respects literal pins through options bindings and casts', () => {
    const root = fixture(`const options = { apiVersion: '2025-08-27.basil' as string };
const pinned = new Stripe('test', options);
pinned.subscriptions.create({});
stripe.invoices.createPreview({subscription_details: {items: []}}, {apiVersion: '2025-08-27.basil'});`);
    expect(scan(root)).toHaveLength(0);
  });
  it('retains the pre-edit version for options bindings that the client inventory cannot resolve', () => {
    const code = `const options = {apiVersion: '2025-08-27.basil'};
const client = new Stripe('test', options);
client.subscriptions.create({});`;
    const root = fixture(code);
    const stripe = {
      apiVersions: { from: '2025-08-27.basil', to: '2025-09-30.clover' },
      movingApiPins: [{ file: 'code.ts', line: 3 }],
    };
    const sitesBefore = recordSites(stripeRecords, {
      root,
      workspace: '.',
      phase: 'before',
      stripe,
    });
    expect(sitesBefore).toHaveLength(1);
    const updated = `import Stripe from 'stripe';\nconst stripe = new Stripe();\n${code.replace('2025-08-27.basil', '2025-09-30.clover')}`;
    writeFileSync(join(root, 'code.ts'), updated);
    const after = recordSites(stripeRecords, {
      root,
      workspace: '.',
      phase: 'after',
      stripe: { ...stripe, sitesBefore },
    });
    expect(after[0]?.unaffected).toBe(false);
  });
  it('resolves factory clients and treats unknown request versions as decisions', () => {
    const root = fixture(`let client: Stripe | null = null;
function getClient() { if (client) return client; client = new Stripe('test', {apiVersion: '2025-08-27.basil'}); return client; }
getClient().subscriptions.create({});
declare const options: {apiVersion?: string};
stripe.invoices.createPreview({ subscription_details: {items: []} }, options);`);
    expect(scan(root)).toHaveLength(1);
    expect(scan(root)[0]?.decisionReason).toContain('API version');
  });
  it('requires a source and proves classic after the session, not mere disappearance or flexible', () => {
    const root = fixture(`stripe.subscriptions.create({ billing_mode: { type: 'classic' } });
stripe.subscriptions.create({ billing_mode: { type: 'flexible' } });
stripe.subscriptions.create({});`);
    expect(scan(root, 'after').map((s) => s.kept)).toEqual([true, false, false]);
    expect(
      recordFindings(
        stripeRecords.map((r) => ({ ...r, sources: [] })),
        { root, workspace: '.', package: 'stripe', from: '18.5.0', to: '22.6.2' },
      ),
    ).toEqual([]);
  });
});
