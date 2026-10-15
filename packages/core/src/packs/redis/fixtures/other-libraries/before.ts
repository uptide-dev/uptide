// No node-redis import: the same names belong to other libraries and are never sites.
import net from 'node:net';

declare const queue: { quit(): Promise<void>; scanIterator(): AsyncIterable<string> };

export const socket = net.connect({ port: 1, keepAlive: true });
export const options = { legacyMode: true, keepAlive: 1000, unstableResp3: true }; // @uptide legacy-mode keep
export async function stop() {
  for await (const key of queue.scanIterator()) console.log(key); // @uptide scan-iterators keep
  await queue.quit();
}
