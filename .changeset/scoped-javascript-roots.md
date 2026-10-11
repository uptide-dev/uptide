---
'uptide': patch
---

Respect the repository's JavaScript compiler setting when selecting scoped analysis roots. This prevents an `escapedName` crash during upgrades in mixed TypeScript/JavaScript monorepos while preserving analysis of enabled JavaScript files.
