---
"uptide": minor
---

`fix` names the first major of a peer blocker that accepts the target (`no 1.x accepts react 19; 2.2.0 does`) and suggests adding it to the command instead of `--allow-peer`. When a verified pack covers that major, the blocker moves as a companion and its pack runs in the same fix: its rules, its detect-based findings and its inventory, each at the companion's own versions. When no pack covers it, the PR says the major needs its own migration and the risk is High. `--allow-peer` stays the suggestion only when no release accepts the target. A group member that the target's own range already accepts (`@casl/ability` under `@casl/react` 5) is no longer reported as a conflict.
