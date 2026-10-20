// A jest mock of the client: its PrismaClient is a local function, not Prisma's.
export const PrismaClient = jest.fn().mockImplementation(() => ({ $disconnect: jest.fn() }));
export const mockPrisma = new PrismaClient(); // @uptide client-adapter keep
