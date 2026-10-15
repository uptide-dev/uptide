import type { RedisClientType } from 'redis';
import { Graph } from '@redis/graph'; // @uptide graph-removed

declare const client: RedisClientType;
export const graph = new Graph(client as never, 'social');
export const search = '@redis/search'; // @uptide graph-removed keep
