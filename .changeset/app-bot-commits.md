---
'uptide': patch
---

The Action's commits are authored by the Uptide App's own bot account,
`<app slug>[bot] <<bot user id>+<app slug>[bot]@users.noreply.github.com>`, resolved with the
installation token, so GitHub links them to the App. When it cannot be resolved they keep
`uptide[bot] <uptide@users.noreply.github.com>` and the job log warns.
