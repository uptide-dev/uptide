---
"uptide": patch
---

With an assisting agent, a root pin Uptide cannot update safely (a nested override such as `overrides > pkg > peerDependencies > react`) no longer stops `fix` with exit 2: the run continues as an agent-led draft that leaves the pin as written and names it, with its exact path and value, at the top of the PR body. The agent-led peer reason now names each blocker's first release that accepts the target, or says none does. An agent-led draft must pass the repository's clean install (`npm ci` or the manager's frozen install) before delivery; if it does not, the PR says so at the top. Without an agent, with `--no-llm`, or on a safety refusal, `fix` still exits 2.
