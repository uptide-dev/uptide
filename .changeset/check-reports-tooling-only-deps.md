---
"uptide": patch
---

`check <pkg>` no longer returns nothing for an outdated dependency used only through config files (typescript through tsconfig): it is always reported, with the reason, including when its workspace's analysis fails or the time budget runs out. Analysis no longer fails with ENAMETOOLONG on a package that links itself (Yarn `link:.`).
