---
'uptide': patch
---

Assisted fixes group two sites of one file into one task only when their fix is in the same place: the same repository declarations behind each compiler error, or none. Two React 19 `RefObject<T | null>` errors in one file whose prop types live in two components were sent as one task that could edit only the first component, and both stayed manual (a regression in 0.8.0).
