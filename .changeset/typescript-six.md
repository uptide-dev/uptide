---
'uptide': minor
---

`check typescript` judges a TypeScript 5 to 6 upgrade with both compilers: every project of the workspace is compiled with the installed TypeScript and with the target's, and what is new at the target is a finding; the bundled compiler never stands in, and a target without a JavaScript API (TypeScript 7) is reported as not compiled. A candidate typescript 5 to 6 pack reports the tsconfig options 6.0 deprecates where they are set, the rootDir default, module-keyword namespaces and import assertions. A peer that rejects the target (typescript-eslint on TypeScript 6) is now reported as a peer conflict even when it is not grouped with the package.
