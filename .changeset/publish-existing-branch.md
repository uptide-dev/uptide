---
'uptide': patch
---

`uptide pr` (and `fix --pr`) publishes when the migration branch is already on GitHub, as it is after a pull request was closed without merging. A branch holding only Uptide's commits is replaced with `--force-with-lease`, and an open Uptide pull request on it is updated instead of a second one being opened. A branch with anyone else's commit is never overwritten: the run goes to the next free `<branch>-2`, `-3`, … and the pull request says so. When publication fails in the Action, the job summary and run report name the reason.
