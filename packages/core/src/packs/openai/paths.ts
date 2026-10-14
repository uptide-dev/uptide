/**
 * Methods whose leading path parameters became named in openai 5 (MIGRATION.md, "Named path
 * parameters"), checked against the declarations of 4.104.0 and 7.32.0: `keys` are the old
 * leading positional ids, in order, as they are named in the new params object; the last id stays
 * positional. `after` is what followed the ids in 4.x: nothing (`none`), a required body, or an
 * optional query that an overload also let be request options.
 *
 * `runs.poll`, `runs.submitToolOutputsAndPoll` and `runs.submitToolOutputsStream` changed the
 * same way although the guide's list omits them: the 7.x declarations take `(runId, params)`.
 */
export interface NamedPathMethod {
  resource: readonly string[];
  method: string;
  keys: readonly string[];
  after: 'none' | 'body' | 'query';
}

const entry = (
  resource: string,
  methods: string[],
  keys: string[],
  after: NamedPathMethod['after'],
): NamedPathMethod[] =>
  methods.map((method) => ({ resource: resource.split('.'), method, keys, after }));

export const NAMED_PATH_METHODS: readonly NamedPathMethod[] = [
  ...entry('vectorStores.files', ['retrieve', 'del', 'content'], ['vector_store_id'], 'none'),
  ...entry('vectorStores.files', ['update'], ['vector_store_id'], 'body'),
  ...entry('vectorStores.fileBatches', ['retrieve', 'cancel'], ['vector_store_id'], 'none'),
  ...entry('vectorStores.fileBatches', ['listFiles'], ['vector_store_id'], 'query'),
  ...entry('beta.threads.runs', ['retrieve', 'cancel', 'poll'], ['thread_id'], 'none'),
  ...entry(
    'beta.threads.runs',
    ['update', 'submitToolOutputs', 'submitToolOutputsAndPoll', 'submitToolOutputsStream'],
    ['thread_id'],
    'body',
  ),
  ...entry('beta.threads.runs.steps', ['retrieve'], ['thread_id', 'run_id'], 'query'),
  ...entry('beta.threads.runs.steps', ['list'], ['thread_id'], 'query'),
  ...entry('beta.threads.messages', ['retrieve', 'del'], ['thread_id'], 'none'),
  ...entry('beta.threads.messages', ['update'], ['thread_id'], 'body'),
  ...entry('fineTuning.checkpoints.permissions', ['del'], ['fine_tuned_model_checkpoint'], 'none'),
  ...entry('evals.runs', ['retrieve', 'del', 'cancel'], ['eval_id'], 'none'),
  ...entry('evals.runs.outputItems', ['retrieve'], ['eval_id', 'run_id'], 'none'),
  ...entry('evals.runs.outputItems', ['list'], ['eval_id'], 'query'),
  ...entry('containers.files', ['retrieve', 'del'], ['container_id'], 'none'),
  ...entry('containers.files.content', ['retrieve'], ['container_id'], 'none'),
];

/** `del` methods of 4.x, each now `delete` (MIGRATION.md, "HTTP method naming"). */
export const DEL_RESOURCES: readonly (readonly string[])[] = [
  'chat.completions',
  'files',
  'models',
  'fineTuning.checkpoints.permissions',
  'vectorStores',
  'vectorStores.files',
  'beta.assistants',
  'beta.threads',
  'beta.threads.messages',
  'responses',
  'evals',
  'evals.runs',
  'containers',
  'containers.files',
].map((r) => r.split('.'));

/**
 * Keys a 4.x call could pass as request options in place of params; 5.x reads the first argument
 * as params only (MIGRATION.md, "Removed request options overloads"). `query` is left out: some
 * params objects could carry it too.
 */
export const REQUEST_OPTION_KEYS = new Set([
  'headers',
  'maxRetries',
  'timeout',
  'signal',
  'idempotencyKey',
  'fetchOptions',
]);
