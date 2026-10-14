import Redis, { Cluster } from 'ioredis';
import * as io from 'ioredis';

const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
const shared = { lazyConnect: true };

export const plain = new Redis(url); // @uptide client-defaults at:new
export const tuned = new Redis(url, { maxRetriesPerRequest: 1 }); // @uptide client-defaults at:new
export const partly = new Redis(url, { protocol: 2 }); // @uptide client-defaults at:new
export const spread = new io.Redis({ ...shared, protocol: 2, retryStrategy: () => 50, keepAlive: 0 }); // @uptide client-defaults at:new
export const cluster = new Cluster([{ host: 'a', port: 6379 }]); // @uptide client-defaults at:new
export const clusterViaDefault = new Redis.Cluster([], { scaleReads: 'slave' }); // @uptide client-defaults at:new
// Every changed default chosen explicitly: nothing left to decide.
export const pinned = new Redis(url, { protocol: 2, retryStrategy: (times: number) => Math.min(times * 50, 2000), keepAlive: 0 }); // @uptide client-defaults keep at:new
export const pinnedCluster = new Cluster([], { redisOptions: { protocol: 2, keepAlive: 0 } }); // @uptide client-defaults keep at:new

export async function lazily() {
  const { Redis: Client } = await import('ioredis');
  return new Client(url, { lazyConnect: true }); // @uptide client-defaults at:new
}

export async function viaDefault() {
  const Client = (await import('ioredis')).default;
  return new Client(url); // @uptide client-defaults at:new
}

// Not ioredis: a class of the same shape from elsewhere.
class Pool {
  constructor(readonly url: string) {}
}
export const pool = new Pool(url); // @uptide client-defaults keep at:new
