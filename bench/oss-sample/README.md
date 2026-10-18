# OSS sample run (UPT-77)

Runs `uptide check` and `uptide fix --no-llm` against a sample of public TypeScript
repositories and classifies every step that is not a success. It measures how the CLI
behaves on code it was not built against. It is a harness, not engine code: nothing in
`packages/` changes.

| File | Role |
| --- | --- |
| `build-sample.mjs` | Builds `sample.json` from GitHub search, pinned by commit, stratified by package manager; owners to skip come from the `UPTIDE_SAMPLE_EXCLUDE_OWNERS` environment variable |
| `sample.json` | The committed sample: 30 repositories, 10 per package manager |
| `run.mjs` | Clones each repository at its commit, installs with scripts off, picks one upgrade target from `uptide list`, runs `check` and `fix --no-llm` |
| `classify.mjs` | One step in, one class out: success, expected, crash, false-refusal, timeout, wrong-exit-code, other |
| `summarize.mjs` | Re-classifies from the saved logs and prints the tables and the groups by fingerprint |
| `summary.md` | The result of the committed run: table, classification, one line per root cause |

```sh
pnpm install --frozen-lockfile --ignore-scripts && pnpm build
node bench/oss-sample/run.mjs --out <out-dir> --concurrency 3
node bench/oss-sample/summarize.mjs <out-dir>
node --test bench/oss-sample/
```

## Rules the runner enforces

- No LLM calls: `fix` always gets `--no-llm` (internal, so every child runs with
  `UPTIDE_INTERNAL=1`), and provider API keys and GitHub tokens are removed from the
  environment of every child process.
- No pushes, no comments: `fix` never gets `--pr`; the runner only reads from GitHub.
- Scripts off: installs use `--ignore-scripts` (`--mode=skip-build` on Yarn Berry), and the
  environment sets `npm_config_ignore_scripts` and `YARN_ENABLE_SCRIPTS=0`.
- No services: `--with-services` is never passed.
- Telemetry off (`UPTIDE_TELEMETRY=0`).
- Raw output stays in `--out` (gitignored). The committed summary holds repository names,
  commit pins and a short reason per row, not logs.

## Target choice

One dependency per repository, from `uptide list --json`: a dependency the code imports with a
newer version, preferring a verified-pack dependency (so `fix --no-llm` has rules to run), then
the widest major gap, then the most call sites. `fix --no-llm` on a dependency without a pack exits 2
before cloning by design; that is `expected`, not a defect.

## Classes

- `crash`: ended by a signal, or an uncaught exception or out-of-memory dump.
- `timeout`: killed at the step limit (`--check-timeout` 900 s, `--fix-timeout` 1800 s).
- `wrong-exit-code`: an exit outside 0, 1, 2, or one that contradicts the `--json` result
  (docs/concepts.md: 0 nothing breaking, 1 breaking found, 2 could not answer).
- `false-refusal`: exit 2 on a repository `list` accepted, not explained by a documented stop.
  Mechanical default for every unexplained exit 2; `summary.md` records the human check.
- `other`: everything else that is not a success, including `fix` exiting 1 (not verified).
- `expected`: the documented no-pack exit above.
