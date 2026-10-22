import { defineConfig, env } from 'prisma/config';

const defaults = { engine: 'classic' }; // @uptide config-removed-options keep

export default defineConfig({
  schema: 'prisma/schema.prisma',
  engine: 'classic', // @uptide config-removed-options
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});
