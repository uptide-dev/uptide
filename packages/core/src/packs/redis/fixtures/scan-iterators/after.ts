import type { RedisClientType } from 'redis';

declare const client: RedisClientType;

export async function sweep() {
  for await (const keyBatch of client.scanIterator({ MATCH: 'session:*' })) for (const key of keyBatch) { // @uptide scan-iterators
    await client.del(key);
  }
  const seen: string[] = [];
  for await (const batch of client.hScanIterator('h')) for (const { field, value } of batch) { // @uptide scan-iterators
    seen.push(`${field}=${value}`);
  }
  for await (const memberBatch of client.sScanIterator('s')) for (const member of memberBatch) seen.push(member); // @uptide scan-iterators
  return seen;
}

export async function arrays(items: AsyncIterable<string>) {
  for await (const item of items) console.log(item); // not a scan iterator
}
