import type { RedisClientType } from 'redis';

declare const client: RedisClientType;

export async function sweep() {
  for await (const key of client.scanIterator({ MATCH: 'session:*' })) { // @uptide scan-iterators
    await client.del(key);
  }
  const seen: string[] = [];
  for await (const { field, value } of client.hScanIterator('h')) { // @uptide scan-iterators
    seen.push(`${field}=${value}`);
  }
  for await (const member of client.sScanIterator('s')) seen.push(member); // @uptide scan-iterators
  return seen;
}

export async function arrays(items: AsyncIterable<string>) {
  for await (const item of items) console.log(item); // not a scan iterator
}
