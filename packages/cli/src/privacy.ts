/**
 * The privacy statement, word for word the same in `--help` and in docs/privacy.md (a test
 * compares them). Change it only together with what the code does.
 */
export const PRIVACY = `Privacy:
  Analysis runs locally. Code goes to Anthropic only for assisted fixes in \`uptide fix\`, and
  only with your own API key from ANTHROPIC_API_KEY. \`fix\` runs them with the Claude Agent
  SDK, which sends the finding, enclosing code, compiler-linked repository declarations and
  compiler error, and can also send files throughout the temporary clone and output from
  type-checks, lint and tests. No account.
  \`check\` and \`verify\` load the \`typescript\` package your repository installs (resolved from its
  node_modules) to compile with, and never run your repository's scripts or other code outside
  \`fix\`'s verification step.
  Anonymous telemetry is off by default and asks for consent in an interactive terminal.
  Set UPTIDE_TELEMETRY=0 to disable it. No IP, code, paths or repo names are collected.
  Other network use: your npm registry for package metadata and tarballs, and once for the
  Agent SDK on the first \`fix\` (asked first in an interactive terminal), npm's advisory
  endpoint from \`list\` (public package names and installed versions; \`--no-advisories\` turns
  it off), PostHog EU only
  after telemetry opt-in, and GitHub when you pass \`fix --pr\` or run \`pr\` / \`pr-body\`.
`;
