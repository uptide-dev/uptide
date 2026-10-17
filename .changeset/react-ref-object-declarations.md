---
"uptide": patch
---

The react pack now reports `RefObject<HTMLElement>` annotations that need `| null` at the declaration, including in files that type a prop with the global `React.RefObject` and never import react. The compiler reports these where a ref is passed in, so the declaration to edit was missed.
