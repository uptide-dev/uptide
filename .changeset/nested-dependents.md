---
'uptide': patch
---

`check` no longer reports a blocker for a direct dependency whose plain dependency range rejects the target (`@azure/ai-projects` on `openai ^6`, verdaccio pinning express 4): the package manager gives it its own nested copy, so it is listed as staying, with the new major that would accept the target when there is one. `pack test` counts a `with` move that `check` leaves and explains (a blocker, a new-major stay or a peer conflict) as explained, and one of a package that does not depend on the lead as the repository's choice; neither fails the run.
