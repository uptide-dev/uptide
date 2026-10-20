datasource db {
  provider = "mongodb" // @uptide mongodb-unsupported
}

model Account {
  id       String @id @map("_id")
  provider String // @uptide mongodb-unsupported keep
}
