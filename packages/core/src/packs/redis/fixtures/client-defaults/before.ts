import * as redis from 'redis';
import { createClient, createCluster } from 'redis';

const shared = { url: process.env.REDIS_URL };

export const plain = createClient(); // @uptide client-defaults
export const tuned = createClient({ url: process.env.REDIS_URL, socket: { connectTimeout: 1000 } }); // @uptide client-defaults
export const resp2Only = createClient({ RESP: 2 }); // @uptide client-defaults
export const cluster = createCluster({ rootNodes: [] }); // @uptide client-defaults
export const viaNamespace = redis.createClient({ RESP: 3 }); // @uptide client-defaults
// Every changed default chosen: nothing left to decide.
export const pinned = createClient({ RESP: 2, commandOptions: { timeout: undefined }, socket: { keepAliveInitialDelay: 5000 } }); // @uptide client-defaults keep
// Options the pack cannot read: a variable, a spread.
export const fromVariable = createClient(shared); // @uptide client-defaults keep
export const spread = createClient({ ...shared }); // @uptide client-defaults keep
