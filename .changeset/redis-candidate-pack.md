---
'uptide': patch
---

Add a candidate redis (node-redis) 4 to 5 and 5 to 6 migration pack, one rule set per major: an upgrade gets the rules of the majors it crosses, so 4 to 6 gets both. 4 to 5 covers `legacyMode`, `commandOptions` and isolation, scan iterators that yield batches, string SCAN cursors, boolean replies that became numbers, enums that became constants, `keepAlive`, `@redis/graph` and internal `dist` imports; 5 to 6 covers the RESP3 client type, `unstableResp3`, and the client defaults 6 changes (RESP3, command timeout, keep-alive delay, maintenance notifications) with a decision per client. Scored against five public upgrades; it stays a candidate until the stricter verified gate lands, since the core 4 to 5 API changes have no real site yet.
