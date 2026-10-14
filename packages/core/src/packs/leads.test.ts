import { expect, it } from 'vitest';
import { definePack } from './contract.js';
import { leadName, leadNames, packLeading } from './leads.js';

const source = 'https://example.com/changelog';
const router = definePack({
  meta: { package: 'router', from: '^1', to: '^2', sources: [], maintainer: 'test' },
  rules: [],
  instructions: '',
  alternateLeads: [{ name: 'router-dom', source }],
});
const dom = definePack({
  meta: { package: 'router-dom', from: '^1', to: '^2', sources: [], maintainer: 'test' },
  rules: [],
  instructions: '',
});

it('resolves an alternate lead to the pack that names it, and leaves other names alone', () => {
  expect(packLeading('router-dom', [router])?.name).toBe('router');
  expect(packLeading('router', [router])?.name).toBe('router');
  expect(packLeading('zod', [router])).toBeUndefined();
  expect(leadName('router-dom', [router])).toBe('router');
  expect(leadName('zod', [router])).toBe('zod');
  expect(leadNames(['router-dom', 'zod', 'router'], [router])).toEqual(['router', 'zod']);
});

it('prefers a pack of the name itself over one that names it as an alternate', () => {
  expect(packLeading('router-dom', [router, dom])?.name).toBe('router-dom');
  expect(leadName('router-dom', [router, dom])).toBe('router-dom');
});
