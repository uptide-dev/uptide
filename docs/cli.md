# CLI reference

This page moved. The reference is now one page per command:

- [`uptide list`](commands/list.md)
- [`uptide check`](commands/check.md), with the HTML report
- [`uptide plan`](commands/plan.md)
- [`uptide fix`](commands/fix.md), with `verify` and `clean`
- [`uptide pr`](commands/pr.md), with `pr-body`
- [`uptide telemetry`](commands/telemetry.md)
- [`uptide init`](commands/init.md), and the settings it writes: [`uptide.yml`](config.md)
- [Models](models.md): choosing a provider and a model
- [`uptide pack`](packs.md#the-uptide-pack-command) (contributors)

The words on every row, the coverage line and the exit codes: [concepts](concepts.md).

Hints default to `npx uptide` (`npx uptide@next` for next builds), including npx, pnpm dlx,
yarn dlx and bunx. They use `uptide` only when the command found on PATH resolves to the running
binary; a project-local install outside PATH still gets the npx form. Detection is lazy and
does not spawn a package manager. They repeat explicit flags accepted by the next
command, while keeping its suggested packages and corrected options. Generated workflow and
config comments and PR bodies use `npx uptide` for readers who may have nothing installed.
Migration reports retain the starting branch (or detached commit) and starting commit. Diff hints
compare against that commit even if the branch moves; `--base` still controls the PR target.
