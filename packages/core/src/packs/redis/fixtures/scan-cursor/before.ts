import type { RedisClientType } from 'redis';

declare const client: RedisClientType;

export async function keys(pattern: string) {
  const found: string[] = [];
  let cursor = 0;
  do {
    const reply = await client.scan(cursor, { MATCH: pattern, COUNT: 100 });
    cursor = reply.cursor;
    found.push(...reply.keys);
  } while (cursor !== 0); // @uptide scan-cursor
  const first = await client.hScan('h', 0); // @uptide scan-cursor
  const fromString = await client.sScan('s', '0'); // @uptide scan-cursor keep
  return { found, first, fromString };
}
