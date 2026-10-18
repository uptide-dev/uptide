---
"uptide": patch
---

The PR description's build check now gives the build's actual result: passed, failed with its first error, or not run and why. When a migration pack doesn't require a build, `fix` still runs the repository's build once on the final head, and `uptide verify` runs it again, and reports what happened. "Not required by the pack" now appears next to that result instead of replacing it. Before, the line read "build not required" even when the repository's build failed. A build the pack doesn't require still doesn't block verification or publishing.
