import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  applicable,
  recordFindings,
  recordProblems,
  recordPrompt,
  recordSites,
} from '../records.js';
import { stripeRecords } from './index.js';

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
  put(
    'node_modules/stripe/index.d.ts',
    `import { Subscriptions } from './types/SubscriptionsResource'; import { Sessions } from './types/Checkout/SessionsResource'; export default class Stripe { subscriptions: Subscriptions; checkout: { sessions: Sessions }; } export type { SubscriptionCreateParams } from './types/SubscriptionsResource'; export type { SessionCreateParams, SubscriptionData } from './types/Checkout/SessionsResource';`,
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
  it('pins verbatim sources and only crosses the clover SDK boundary', () => {
    expect(recordProblems(stripeRecords, import.meta.dirname, 'stripe')).toEqual([]);
    expect(applicable(stripeRecords, '18.5.0', '22.6.2')).toHaveLength(1);
    expect(applicable(stripeRecords, '19.0.0', '22.6.2')).toHaveLength(0);
    expect(applicable(stripeRecords, '18.0.0', '18.5.0')).toHaveLength(0);
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
