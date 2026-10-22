import { PrismaBetterSQLite3 } from '@prisma/adapter-better-sqlite3'; // @uptide adapter-renames
import { PrismaNeon } from '@prisma/adapter-neon'; // @uptide adapter-renames keep
import { Prisma, PrismaClient } from '@prisma/client';
import type { Decimal } from '@prisma/client/runtime/library'; // @uptide removed-entrypoints
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client'; // @uptide removed-entrypoints keep

const prisma = new PrismaClient({ adapter: new PrismaBetterSQLite3({ url: 'file:./dev.db' }) }); // @uptide client-adapter keep

prisma.$use(async (params, next) => next(params)); // @uptide client-middleware
const timing: Prisma.Middleware = async (params, next) => next(params); // @uptide client-middleware
app.use(express.json()); // @uptide client-middleware keep

export const metrics = await prisma.$metrics.json(); // @uptide metrics-removed
export const counts = report.metrics.json(); // @uptide metrics-removed keep

export const pooled = `postgresql://u:p@db:5432/app?connection_limit=5&pool_timeout=10`; // @uptide connection-url-params
export const scoped = 'postgresql://u:p@db:5432/app?schema=public'; // @uptide connection-url-params keep

export const edge = await import('@prisma/client/wasm'); // @uptide removed-entrypoints
export { timing, PrismaNeon, PrismaClientKnownRequestError, type Decimal };
