---
"uptide": patch
---

`fix` no longer hides an agent session that could not work. When the Anthropic API refuses the request (an invalid key, an empty credit balance, a model the key cannot use), the Agent SDK ends the session after one turn with nothing spent and the API's message; Uptide dropped that message, recorded "made no change" for every site and ran the feedback rounds into the same error. Now the task records the error (`llm.tasks[].error`, gate `error`), no further session starts, and every task that leaves nothing says why in `llm.tasks[].noChange`: the API's error, no turn, no output, a refusal, a stop, or every edit rejected. When nothing the agent did stayed, `report.json` (`llm.agentIdle`), the terminal and the PR body say "The agent did not change anything: <reason>", and the PR body no longer says the code was migrated when every site is still manual.
