---
"uptide": patch
---

The ai pack now reports AI SDK 7 renames in tests that `vi.mock('ai')` or `jest.mock('ai')` without importing it: the mock factory's `stepCountIs` key, and `onFinish` and the other renamed options read by fakes of `ai` calls such as `toUIMessageStreamResponse`.
