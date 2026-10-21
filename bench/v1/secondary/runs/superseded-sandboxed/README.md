# Superseded sandboxed Arm B runs

Kept for the record and excluded from every table. Copied from `../../../full/results.md`.

One more run is superseded since that table was written: `7ddd8a4c` (context-library). It ran sandboxed under `fbba13f` because jq's `//` read `claudeSandbox: false` as missing. Fixed in `19e2e27`.


**Arm B's sandbox:** phase 1 and the dev set ran Arm B inside Claude Code's sandbox (since the pilot, `920512f`). The secondary set's Arm B does not (`../arms.md`, phase 2 amendment 2).
- **Why:** the sandbox blocked local servers (`listen EPERM`) and the system certificate store, which Uptide's verification is not limited by, so it biased the comparison against Arm B.
- **Dev set:** its numbers keep their sandboxed Arm B.

The 9 secondary Arm B runs made under the sandbox, before the change, are **superseded**: kept for the record, excluded from every table, and replaced by 3 fresh Arm B runs per repository.
- **The audit grep:** `summary.md` + `agent.log` for `EPERM|operation not permitted|sandbox|blocked|denied|not allowed|proxy|EACCES|ECONNREFUSED|listen|bind`, and `permission_denials` from `agent.json` (0 in every run).

| run | repo | sandbox effect | evidence |
|---|---|---|---|
| `def596ad` | context-library r1 | yes | "20 tests fail and 353 are skipped, because the sandbox can't run the server or Postgres tests … (`listen EPERM ... tsx-502/*.pipe`)" |
| `86391203` | aicomply r1 | yes | 15 tests "fail here only because of the sandbox": `guard-client.test.ts` "(`listen EPERM`)", `hma-scan.test.ts` "the sandbox blocks access to the system certificate store" |
| `4245520d` | aicomply r2 | yes | the same 15: "`listen EPERM`", "failed to copy trust settings of system certificate" |
| `1416a7d9` | flaky-triage r2 | yes | "`npm run test:e2e` and `npm run changelog:check` both stop immediately: the sandbox blocks the `tsx` tool from opening its local pipe (`listen EPERM`)". The bar's `npm run demo` is a tsx script too. |
| `632a7bc2` | flaky-triage r1 | likely | no denial in its summary; the same tsx block applies to `npm run demo` |
| `70479465`, `78f2f3da` | riseup r1, r2 | no match | |
| `f4d525f9`, `900691e8` | payflow r1, r2 | no match | |

Every one of their final `check.sh` runs, which are unsandboxed, passed tests except context-library's.
