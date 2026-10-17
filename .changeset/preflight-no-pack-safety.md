---
"uptide": patch
---

`fix` makes the no-pack stop (no agent, or a major for a PR) before cloning or installing. When the check returns nothing to analyze for an outdated package, `fix` now says so instead of "has no upgrade", and an agent continues as a draft. Lockfile resolutions an agent-led install changed outside the upgrade are listed for review in the PR body and the terminal summary. Downgrades, key-like settings in `uptide.config.json`, credentials in `OPENAI_BASE_URL` and unsafe run reports throw `SafetyRefusal`, which no fallback continues past.
