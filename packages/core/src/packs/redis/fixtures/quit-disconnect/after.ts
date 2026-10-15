import type { RedisClientType } from 'redis';

declare const client: RedisClientType;

export async function shutdown() {
  await client.close(); // @uptide quit-disconnect at:quit
}

export async function abort() {
  await client.destroy(); // @uptide quit-disconnect at:disconnect
}
