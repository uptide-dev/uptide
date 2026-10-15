import { commandOptions, type RedisClientOptions, type RedisClientType } from 'redis';

declare const client: RedisClientType;

export async function read(key: string) {
  const buffer = await client.get(commandOptions({ returnBuffers: true }), key); // @uptide command-options
  const viaClient = await client.get(client.commandOptions({ isolated: true }), key); // @uptide command-options
  // Through `any`: the compiler cannot see this one.
  const untyped = await (client as any).hGetAll((client as any).commandOptions({ returnBuffers: true }), key); // @uptide command-options
  return { buffer, viaClient, untyped };
}

export async function blocking() {
  return client.executeIsolated((isolated) => isolated.blPop('queue', 0)); // @uptide command-options
}

// v5's own options: a property and a method, not the v4 call.
export const v5: RedisClientOptions = { commandOptions: { timeout: 1000 } }; // @uptide command-options keep
export const proxy = client.withCommandOptions({ asap: true }); // @uptide command-options keep
