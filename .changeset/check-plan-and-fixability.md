---
'uptide': patch
---

`check` prints what moves with a package, what the target requires, what blocks it, the `@types` stubs it removes and what stays on every row that has any, a row where nothing breaks included, in the summary and in `--details`; such a row is never folded away. `pack test` reports removals. A site's fixability now comes from the same dry run as the plan, so the summary, `--details` and `--json` agree (an unpinned Stripe client is `mechanical` in all three). The PR body says each decision once: an agent's restatement of a decision the pack already asks for is dropped, and the same choice in several files is one bullet.
