import type { RedisClientOptions } from 'redis';

export const delayed: RedisClientOptions = { socket: { host: 'cache', keepAlive: true, keepAliveInitialDelay: 10000 } }; // @uptide keep-alive
export const off: RedisClientOptions = { socket: { keepAlive: false } }; // @uptide keep-alive keep
export const fromEnv = { socket: { keepAlive: Number(process.env.KA) } }; // @uptide keep-alive keep
