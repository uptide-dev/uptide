generator client {
  provider        = "prisma-client-js"
  engineType      = "binary" // @uptide engine-type
  previewFeatures = ["metrics", "views"] // @uptide metrics-removed
}

generator docs {
  provider = "prisma-docs-generator"
}

datasource db {
  provider          = "postgresql" // @uptide mongodb-unsupported keep
  url               = env("DATABASE_URL") // @uptide schema-datasource-url
  directUrl         = env("DIRECT_URL") // @uptide schema-datasource-url
  shadowDatabaseUrl = env("SHADOW_DATABASE_URL") // @uptide schema-datasource-url
  extensions        = [uuidOssp(map: "uuid-ossp")]
}

model Link {
  id         Int    @id @default(autoincrement())
  url        String // @uptide schema-datasource-url keep
  engineType String // @uptide engine-type keep
}
