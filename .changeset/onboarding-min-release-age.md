---
'uptide': patch
---

The onboarding generator (`uptide/onboarding`, the "Add Uptide" pull request) writes
`minReleaseAgeDays` to `uptide.yml`, with a comment, when the settings set it. Before, the
setting was kept in the returned config but left out of the file.
