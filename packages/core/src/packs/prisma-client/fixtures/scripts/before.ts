{
  "name": "app",
  "scripts": {
    "generate": "prisma generate", // @uptide env-not-loaded keep
    "db:push": "dotenv -- prisma db push --skip-generate", // @uptide cli-skip-flags
    "db:dev": "dotenv -- prisma migrate dev --skip-seed --skip-generate", // @uptide cli-skip-flags
    "test": "vitest run --skip-generate", // @uptide cli-skip-flags keep
    "db:deploy": "prisma migrate deploy", // @uptide env-not-loaded
    "db:studio": "pnpm exec prisma studio", // @uptide env-not-loaded
    "db:deploy:ci": "dotenv -e .env.ci -- prisma migrate deploy", // @uptide env-not-loaded keep
    "db:migrate": "dotenv -- prisma migrate dev", // @uptide cli-implicit-steps
    "db:sync": "dotenv -- prisma db push && prisma generate", // @uptide cli-implicit-steps keep
    "db:diff": "dotenv -- prisma migrate diff --from-url \"$DATABASE_URL\" --to-schema prisma/schema.prisma --script", // @uptide cli-removed-flags
    "db:diff:config": "dotenv -- prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma", // @uptide cli-removed-flags keep
    "introspect": "npx prisma introspect" // @uptide cli-removed-flags
  },
  "prisma": { // @uptide package-json-prisma
    "seed": "tsx prisma/seed.ts"
  },
  "pnpm": {
    "overrides": {
      "prisma": { // @uptide package-json-prisma keep
        "@prisma/engines": "6.19.3"
      }
    }
  },
  "devDependencies": {
    "prisma": "^6.19.3" // @uptide package-json-prisma keep
  }
}
