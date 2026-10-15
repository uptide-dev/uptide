import type { RedisClientType } from 'redis';

declare const client: RedisClientType;

export async function shutdown() {
  await client.quit(); // @uptide quit-disconnect at:quit
}

export async function abort() {
  await client.disconnect(); // @uptide quit-disconnect at:disconnect
}
