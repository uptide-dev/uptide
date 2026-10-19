---
'uptide': patch
---

`check` finds the migration pack of any member of an upgrade group: the member a pack covers now leads the group, so react 18 → 19 named together with react-dom (as the Uptide Action names every used dependency) is analyzed by the react pack and reported as `react`, verified, instead of `react-dom` with no pack.
