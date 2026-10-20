import { PrismaClient } from '@prisma/client';

// A jest mock of the client: its PrismaClient is a fake, never Prisma's.
jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn(() => ({})) }));

export const mockPrisma = new PrismaClient(); // @uptide client-adapter keep

export const LocalClient = jest.fn().mockImplementation(() => ({ $disconnect: jest.fn() }));
export const local = new LocalClient(); // @uptide client-adapter keep
