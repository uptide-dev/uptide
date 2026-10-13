/**
 * Credentials by shape: provider API keys, GitHub tokens (personal, OAuth, App installation
 * `ghs_`, fine-grained), Slack tokens, bearer headers and JWTs (an OIDC token is one). Used to
 * refuse them in config files and to keep them out of anything Uptide sends or prints.
 */
export const CREDENTIAL =
  /(?:sk-[\w-]{8,}|AIza[\w-]{12,}|phc_[\w-]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|xox[abpr]-[\w-]{8,}|bearer\s|eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,})/i;
