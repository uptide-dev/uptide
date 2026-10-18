---
"uptide": patch
---

pack test runs a ground-truth repository's code generators (prisma generate, local graphql-codegen) after its install, as fix does. It fetches the Prisma engines the locked version needs itself, so generators stay off the network. A repository whose generator still fails is incomplete and fails the pack, unless its ground truth declares `withoutGenerated`
