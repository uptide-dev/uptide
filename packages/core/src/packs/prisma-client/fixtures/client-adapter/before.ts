import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

export const bare = new PrismaClient(); // @uptide client-adapter
export const logged = new PrismaClient({ log: ['query'] }); // @uptide client-adapter
export const routed = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } }, // @uptide client-adapter
});
export const direct = new PrismaClient({
  log: ['warn'],
  datasourceUrl: process.env.DATABASE_URL, // @uptide client-adapter
});
export const adapted = new PrismaClient({ adapter: new PrismaPg({ connectionString: '' }) }); // @uptide client-adapter keep
export const accelerated = new PrismaClient({ accelerateUrl: process.env.ACCELERATE_URL }); // @uptide client-adapter keep
export const built = new PrismaClient(options); // @uptide client-adapter keep
export const spread = new PrismaClient({ ...options }); // @uptide client-adapter keep

const { PrismaClient: Required } = require('@prisma/client');
export const required = new Required(); // @uptide client-adapter

export async function generated() {
  const clientModule: string = '../generated/client/index.js';
  const { PrismaClient: Generated } = (await import(clientModule)) as { PrismaClient: new () => unknown };
  return new Generated(); // @uptide client-adapter
}
