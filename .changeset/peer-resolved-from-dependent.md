---
"uptide": patch
---

Peer warnings in `check` and `plan` report the version the upgraded package actually resolves, found from its own installed directory as Node does, instead of another copy of the peer the repository has (an older one nested under a workspace, for example).
