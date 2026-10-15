---
'uptide': patch
---

`uptide pack test` fails a pack's `verification.json` only when it claims more than the run measures (recorded verified, measured candidate). A pack recorded as candidate on purpose passes, with `recorded candidate by choice; measures verified`, and a record whose numbers differ gets a note instead of a failure. A `generic` ground-truth site now counts as a true positive for the rule that claims it.
