import type { RedisClientType } from 'redis';

declare const client: RedisClientType;

export async function find(q: string) {
  const hits = await client.ft.search('idx:docs', q, { LIMIT: { from: 0, size: 10 } }); // @uptide search-dialect-2
  const bare = await client.ft.search('idx:docs', q); // @uptide search-dialect-2
  const counts = await client.ft.aggregate('idx:docs', '*', { STEPS: [] }); // @uptide search-dialect-2
  const pinned = await client.ft.search('idx:docs', q, { DIALECT: 1 }); // @uptide search-dialect-2 keep
  const created = await client.ft.create('idx:docs', {}); // @uptide search-dialect-2 keep
  return { hits, bare, counts, pinned, created };
}
