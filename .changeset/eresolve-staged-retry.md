---
"uptide": patch
---

`fix` on npm no longer stops when the lock-only install hits ERESOLVE from the old lockfile. It retries without the lockfile entries of the moved packages, their companions and the packages whose peers they satisfy, and only then with the whole lockfile re-resolved; the report says which step worked, and the lockfile check reports the churn as usual. It never uses `--legacy-peer-deps` or `--force`. When every step fails, `fix` ends blocked, naming the conflicting packages from npm's ERESOLVE report. `fix --json` now prints JSON on every exit, a failure included; when the run already has its report (a PR body over GitHub's size limit), that report comes with the error.
