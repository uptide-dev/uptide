import type { RedisClientOptions } from 'redis';

export const legacy: RedisClientOptions = {
  url: process.env.REDIS_URL,
  legacyMode: true, // @uptide legacy-mode
};

// A property of the same name in a file that uses node-redis is read too: `legacyMode` has no
// other meaning there.
export const flags = { legacyMode: false }; // @uptide legacy-mode
