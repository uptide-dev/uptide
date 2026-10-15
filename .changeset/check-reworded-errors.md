---
'uptide': patch
---

`check` no longer reports a pre-existing type error as a breaking site when the upgrade only changes its wording, such as a type the message prints in full. An error at the same place with a different reason is still reported.
