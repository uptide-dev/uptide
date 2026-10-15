import { definePack } from '../contract.js';
import { ioredisBehavior } from './behavior.js';

const guide = 'https://github.com/redis/ioredis/wiki/Upgrading-from-v5-to-v6';
const tag = 'https://github.com/redis/ioredis/blob/v6.0.0';
const commit = (sha: string) => `https://github.com/redis/ioredis/commit/${sha}`;

/**
 * ioredis >=5 <6 → >=6 <7. Sources read 2026-10-14; the classification of every change, the
 * ground truth and what the engine cannot express are in RESEARCH.md. ioredis 6 keeps the v5
 * reply shapes and types for default clients ("legacy" mapping), removes no command, and changes
 * connection behavior the compiler cannot see: almost everything here is a note, never a rewrite.
 */
export const ioredisPack = definePack({
  meta: {
    package: 'ioredis',
    from: '>=5 <6',
    to: '>=6 <7',
    sources: [
      { title: 'Upgrading from v5 to v6, ioredis wiki at e859962 (read 2026-10-14)', url: guide },
      { title: 'ioredis 6.0.0 changelog (read 2026-10-14)', url: `${tag}/CHANGELOG.md` },
      { title: 'ioredis 6.0.0 README, RESP3 Protocol (read 2026-10-14)', url: `${tag}/README.md` },
      {
        title: 'Add RESP3 (#2127), the breaking commit',
        url: commit('5d0862e078c1252470872fa3a96d7435bb34f078'),
      },
      {
        title: 'Improve default connection resilience (#2160): retryStrategy and keepAlive',
        url: commit('6d0716ef9b3c7c5676c8d866388075e927f6b8b7'),
      },
      {
        title: 'Keep String.prototype in fast mode (#2206), after 6.0.0',
        url: commit('90e1261ce71f4e77ad00f54690eda54123c34bc6'),
      },
      {
        title: 'BullMQ 6.0.0 changelog: ioredis becomes an optional peer (read 2026-10-14)',
        url: 'https://github.com/taskforcesh/bullmq/blob/master/docs/gitbook/changelog.md',
      },
    ],
    maintainer: 'uptide-dev',
  },
  defaultTarget: '6.0.0',
  inventory: ['package.json', '{.nvmrc,.node-version}', '.github/workflows/*.{yml,yaml}'],
  rules: [
    {
      id: 'bundled-ioredis',
      summary: 'a v6 client passed where a dependency expects the ioredis 5 it installs itself',
      severity: 'breaking',
      kinds: ['type', 'signature'],
      symbols: /^TS(?:2322|2345|2739|2740|2741)$/,
      message: /\b(?:Redis|Cluster)<"(?:legacy|resp3)">'? is not assignable to/,
      guide:
        'The dependency at this site installs its own ioredis 5 (bullmq before 6, bull, @hocuspocus/extension-redis and others: see Decisions), so TypeScript sees two Redis classes. Options: (a) upgrade the dependent to a release that peers on ioredis, such as bullmq 6, which is a major migration of its own and must be reported as one; (b) pass connection options instead of the client instance, which hands connection ownership to the dependent; (c) keep ioredis 5 in this workspace until the dependent accepts 6; (d) where the workspace already forces one ioredis copy (an override), confirm the dependent supports 6 before relying on it. Say which you chose. Never cast the client (as any, as unknown as) to silence the error.',
    },
    {
      id: 'duplicate-signature',
      summary: 'Redis#duplicate and Cluster#duplicate became generic over the reply mapping',
      severity: 'breaking',
      kinds: ['type', 'signature'],
      symbols: /^TS(?:2416|2430)$/,
      message: /'duplicate'/,
      guide:
        'ioredis 6 declares duplicate<Override>(override?) returning Redis<mapping inferred from the override>, and Cluster#duplicate takes ClusterNode[] instead of any[]. A subclass override must match: make it generic the same way and return the base result, keeping the options it passes. Do not widen it to any.',
    },
  ],
  behavior: ioredisBehavior,
  instructions:
    'Sources read 2026-10-14; see RESEARCH.md. ioredis 6 keeps default reply shapes ("legacy" mapping) and removes no command. Migrate only reported sites. Do not change protocol, retryStrategy, keepAlive, enableOfflineQueue or replyMapping unless the decision for that client says so, and never opt into replyMapping "resp3" as part of the upgrade. Preserve credential redaction, error handling, reconnect behavior and pub/sub semantics. Never cast a client to any or suppress a diagnostic to get a clean compile.',
});
