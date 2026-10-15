import { definePack } from '../contract.js';
import { openaiBehavior } from './behavior.js';
import {
  betaChatSites,
  corePathSites,
  deleteMethodSites,
  fileFromPathSites,
  namedPathSites,
  pageHelperSites,
  removedModuleSites,
  requestOptionSites,
  runFunctionsSites,
  runnerSites,
} from './detect.js';
import {
  promoteBetaChat,
  renameDel,
  renameRunner,
  rewriteCorePath,
  rewriteNamedPathParams,
  rewriteRemovedModule,
  SDK_DEL,
  separateRequestOptions,
} from './rewrite.js';

const repo = 'https://github.com/openai/openai-node';
const migration = `${repo}/blob/v7.32.0/MIGRATION.md`;
const changelog = `${repo}/blob/v7.32.0/CHANGELOG.md`;

/**
 * openai 4 → 7, in one pack: sources pinned at 7.32.0 and read 2026-10-14 (RESEARCH.md, with
 * every change classified). 5.0 carries the API changes (MIGRATION.md); 5.12.1 made tool calls
 * a function | custom union; 6.0's one breaking change widens function-call outputs; 7.0's is the
 * Node 22 floor. Rewrites are made only where they are the same request whatever the code around
 * them is; model names, prompts and parameter values are never touched.
 *
 * No release group: the openai-node repository publishes `openai` alone, and `@openai/agents`
 * (which depends on it) is versioned on its own line. `requiresBuild`: 7.x exports explicit
 * subpaths only, so a deep import TypeScript still resolves from disk (`moduleResolution: node`)
 * can fail in Node or a bundler, and only the build shows it.
 */
export const openaiPack = definePack({
  meta: {
    package: 'openai',
    from: '>=4 <5',
    to: '>=7 <8',
    sources: [
      { title: 'openai-node migration guide, v7.32.0 (read 2026-10-14)', url: migration },
      {
        title: 'openai-node migration guide as released with 5.0.0',
        url: `${repo}/blob/v5.0.0/MIGRATION.md`,
      },
      { title: 'openai-node changelog, 5.0.0 to 7.32.0 (read 2026-10-14)', url: changelog },
      {
        title: 'openai 5.12.1: tool calls become a function | custom union',
        url: `${repo}/releases/tag/v5.12.1`,
      },
      { title: 'openai 6.0.0: function call outputs widen', url: `${repo}/releases/tag/v6.0.0` },
      { title: 'openai 7.0.0: Node.js 22 required', url: `${repo}/releases/tag/v7.0.0` },
    ],
    maintainer: 'uptide-dev',
  },
  defaultTarget: '7.32.0',
  requiresBuild: true,
  inventory: [
    'package.json',
    '{.nvmrc,.node-version}',
    '.github/workflows/*.{yml,yaml}',
    'tsconfig*.json',
    '*.{ts,mts,cts,js,mjs,cjs}',
    '{src,app,lib,server,api,pages,utils,services,scripts}/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}',
  ],
  rules: [
    {
      id: 'named-path-params',
      summary:
        'methods with several path ids take the last one positionally and the others as named params',
      severity: 'breaking',
      kinds: ['signature', 'type', 'removed', 'required'],
      symbols:
        /(?:VectorStores\.Files#(?:retrieve|update|del|delete|content)|VectorStores\.FileBatches#(?:retrieve|cancel|listFiles)|Threads\.Runs#(?:retrieve|update|cancel|poll|submitToolOutputs\w*)|Runs\.Steps#(?:retrieve|list)|Threads\.Messages#(?:retrieve|update|del|delete)|Checkpoints\.Permissions#(?:del|delete)|Evals\.Runs#(?:retrieve|del|delete|cancel)|Runs\.OutputItems#(?:retrieve|list)|Containers\.Files#(?:retrieve|del|delete)|Files\.Content#retrieve)$|^TS(?:2345|2554|2769)$/,
      message:
        /(?:^$|(?:Run|Step|Message|File|FileBatch|Permission|OutputItem|Content)(?:Retrieve|Update|Delete|Cancel|Content|ListFiles|List|SubmitToolOutputs\w*)Params)/,
      detect: namedPathSites,
      rewrite: rewriteNamedPathParams,
      guide:
        'openai 5 names every path id but the last: `client.beta.threads.runs.retrieve(threadId, runId)` is `client.beta.threads.runs.retrieve(runId, { thread_id: threadId })`; a body merges into the same object (`submitToolOutputs(runId, { thread_id: threadId, tool_outputs })`), and request options stay the last argument. Keys: vector store files and file batches `vector_store_id`; runs, run steps and messages `thread_id` (steps also `run_id`); eval runs `eval_id` (output items also `run_id`); container files `container_id`; checkpoint permissions `fine_tuned_model_checkpoint`. `runs.poll`, `submitToolOutputsAndPoll` and `submitToolOutputsStream` changed the same way. Keep every id and value as it is.',
    },
    {
      id: 'delete-method',
      summary: '`.del()` is `.delete()` on every resource',
      severity: 'breaking',
      kinds: ['removed', 'type', 'renamed'],
      symbols: /#del$|^TS(?:2339|2551)$/,
      message: new RegExp(`(?:^$|${SDK_DEL.source})`),
      detect: deleteMethodSites,
      rewrite: renameDel,
      guide:
        '`.del(id)` is `.delete(id)` with the same arguments. Where the resource has several path ids (vector store files, thread messages, eval runs, container files, checkpoint permissions), the ids are also reshaped as in named-path-params.',
    },
    {
      id: 'beta-chat',
      summary: '`beta.chat.completions` (parse, stream, runTools) moved to `chat.completions`',
      severity: 'breaking',
      kinds: ['removed', 'type'],
      symbols: /(?:^|[.#])Beta#chat$|^TS2339$/,
      message: /(?:^$|Property 'chat' does not exist on type 'Beta')/,
      detect: betaChatSites,
      rewrite: promoteBetaChat,
      guide:
        '`client.beta.chat.completions.parse|stream|runTools` is `client.chat.completions.parse|stream|runTools`: the same methods and arguments, promoted out of beta.',
    },
    {
      id: 'runner-renames',
      summary:
        'runTools runner events and methods are renamed: `functionCall` → `functionToolCall`, `finalFunctionCall()` → `finalFunctionToolCall()`',
      severity: 'breaking',
      kinds: ['removed', 'type', 'signature', 'renamed'],
      symbols: /#finalFunctionCall(?:Result)?$|^TS(?:2345|2339|2551|2769)$/,
      message: /(?:^$|['"](?:final)?[fF]unctionCall(?:Result)?['"])/,
      detect: runnerSites,
      rewrite: renameRunner,
      guide:
        "Rename the runner's events `functionCall`, `functionCallResult`, `finalFunctionCall`, `finalFunctionCallResult` to `functionToolCall`, `functionToolCallResult`, `finalFunctionToolCall`, `finalFunctionToolCallResult`, and the methods `finalFunctionCall()` / `finalFunctionCallResult()` to `finalFunctionToolCall()` / `finalFunctionToolCallResult()`. The payloads keep their shape.",
    },
    {
      id: 'run-functions',
      summary: '`runFunctions()` is removed: use `runTools()`',
      severity: 'breaking',
      kinds: ['removed', 'type'],
      symbols: /#runFunctions$|^TS(?:2339|2551)$/,
      message: /(?:^$|'runFunctions')/,
      detect: runFunctionsSites,
      guide:
        '`chat.completions.runFunctions({ functions: [{ function, parse, description }] })` is `chat.completions.runTools({ tools: [{ type: "function", function: { function, parse, description } }] })` (wrap each function, keep its name, parameters and parse), and a forced `function_call: { name }` is `tool_choice: { type: "function", function: { name } }`. Rename the runner events as in runner-renames. Keep the model, messages and every other parameter.',
    },
    {
      id: 'removed-modules',
      summary:
        '`openai/shims/*`, `openai/src`, `openai/core` and `openai/resources/beta/chat/completions` are gone',
      severity: 'breaking',
      kinds: ['removed', 'type'],
      symbols: /^TS(?:2307|2792)$/,
      message: /'openai\/(?:_?shims|src|core'|resources\/beta\/chat)/,
      detect: removedModuleSites,
      rewrite: rewriteRemovedModule,
      guide:
        "Remove a side-effect `import 'openai/shims/node'` (or `web`): openai 5 always uses the runtime's fetch, and the global types must come from lib DOM or @types/node >= 20. `openai/resources/beta/chat/completions` types (ParsedChatCompletion, ParsedChoice, ParsedFunction, runner types) are in `openai/resources/chat/completions`; `openai/src/*` is `openai/*`. From `openai/core`, errors and pagination are in `openai/core/error` and `openai/core/pagination`, and `APIClient` is the `OpenAI` client itself. Ask before replacing an internal the SDK no longer exports.",
    },
    {
      id: 'core-paths',
      summary:
        '`openai/error`, `pagination`, `resource`, `streaming` and `uploads` moved to `openai/core/*`; the old paths are deprecated aliases',
      severity: 'deprecated',
      kinds: [],
      symbols: /$^/,
      detect: corePathSites,
      rewrite: rewriteCorePath,
      guide: 'Import from `openai/core/<name>` instead of `openai/<name>`: the same exports.',
    },
    {
      id: 'request-options',
      summary:
        'request options alone are no longer accepted in place of params: pass `{}` (or the params) first',
      severity: 'breaking',
      kinds: ['type', 'signature'],
      symbols: /^TS(?:2353|2559|2345)$/,
      message:
        /(?:'(?:headers|maxRetries|timeout|signal|idempotencyKey|fetchOptions)' does not exist in type '\w*Params'|has no properties in common with type '\w*Params'|Argument of type '\{ (?:headers|maxRetries|timeout|signal|idempotencyKey|fetchOptions)\b[^']*' is not assignable to parameter of type '\w*Params')/,
      detect: requestOptionSites,
      rewrite: separateRequestOptions,
      guide:
        '`client.files.list({ headers })` is `client.files.list({}, { headers })`: a method without required params reads its first argument as params, and request options are always the next argument.',
    },
    {
      id: 'http-agent',
      summary: 'the `httpAgent` client option is removed in favor of `fetchOptions`',
      severity: 'breaking',
      kinds: ['type', 'removed', 'signature'],
      symbols: /ClientOptions#httpAgent$|^TS(?:2353|2561)$/,
      message: /(?:^$|'httpAgent')/,
      guide:
        "openai 5 sends requests with the runtime's fetch, which takes no node:http agent. This is the owner's choice; pick one and report it under decisions, with the alternatives: (a) a proxy agent becomes `fetchOptions: { dispatcher: new ProxyAgent(url) }` with `ProxyAgent` from `undici` (a new dependency); (b) keep-alive or socket tuning becomes an undici `Agent` as `dispatcher`; (c) a custom `fetch` client option when the code already wraps fetch. Keep the proxy URL and every other option; never drop the agent silently.",
    },
    {
      id: 'file-from-path',
      summary: '`fileFromPath` is removed: pass a read stream',
      severity: 'breaking',
      kinds: ['removed', 'type'],
      symbols: /fileFromPath$|^TS(?:2305|2339|2614|2724)$/,
      message: /(?:^$|'fileFromPath')/,
      detect: fileFromPathSites,
      guide:
        "`await fileFromPath(path)` becomes a read stream of the same file. This is the owner's choice; pick one and report it under decisions: (a) `fs.createReadStream(path)`, as the migration guide shows; (b) `await toFile(fs.createReadStream(path), name, { type })` from `openai`, when the code passed a file name or content type that must be kept. Bun code may use `Bun.file(path)`.",
    },
    {
      id: 'page-helpers',
      summary: '`nextPageParams()` and `nextPageInfo()` are replaced by `nextPageRequestOptions()`',
      severity: 'breaking',
      kinds: ['removed', 'type'],
      symbols: /#nextPage(?:Params|Info)$|^TS(?:2339|2551)$/,
      message: /(?:^$|'nextPage(?:Params|Info)')/,
      detect: pageHelperSites,
      guide:
        'Prefer `for await (const item of page)` or `page.getNextPage()`; where the code needs the next request itself, `page.nextPageRequestOptions()` returns request options (or null) instead of the `{ params } | { url }` union. Keep the paging logic.',
    },
    {
      id: 'page-classes',
      summary: 'page classes of single methods are now type aliases',
      severity: 'breaking',
      kinds: ['type', 'removed'],
      symbols: /^TS(?:2693|2749|2348|2351)$/,
      message: /'\w*Page' only refers to a type/,
      guide:
        '`FineTuningJobsPage` and its kind are type aliases (`CursorPage<FineTuningJob>`): use them as types only, and `CursorPage` / `Page` from `openai/core/pagination` where a value (instanceof, construction) is needed.',
    },
    {
      id: 'removed-exports',
      summary:
        'internals of `openai/core` and `openai/uploads` (APIClient, BlobLike, createForm, …) and the runFunctions types are no longer exported',
      severity: 'breaking',
      kinds: ['removed', 'type'],
      symbols:
        /(?:^|[.#])(?:APIClient|BlobPart|BlobLike|FileLike|ResponseLike|isResponseLike|isBlobLike|isFileLike|isUploadable|isMultipartBody|maybeMultipartFormRequestOptions|multipartFormRequestOptions|createForm)$|^TS(?:2305|2614|2724)$/,
      message:
        /(?:^$|has no exported member (?:named )?'(?:APIClient|BlobPart|BlobLike|FileLike|ResponseLike|isResponseLike|isBlobLike|isFileLike|isUploadable|isMultipartBody|maybeMultipartFormRequestOptions|multipartFormRequestOptions|createForm|RunnableFunction|RunnableFunctions|ParsingFunction|ChatCompletionFunctionRunnerParams|ChatCompletionStreamingFunctionRunnerParams)')/,
      guide:
        '`APIClient` is the `OpenAI` client. `Uploadable` and `toFile` stay exported from `openai/core/uploads`; the other upload helpers were internal: use `toFile` or standard `File`/`Blob`. The runFunctions types go with runFunctions (see run-functions). Ask before re-implementing an SDK internal.',
    },
    {
      id: 'tool-call-union',
      summary:
        '`ChatCompletionMessageToolCall` and `ChatCompletionTool` are function | custom unions (5.12.1): narrow on `type` before reading `.function`',
      severity: 'breaking',
      kinds: ['removed', 'type', 'signature'],
      symbols:
        /(?:ChatCompletionMessageToolCall|ChatCompletionTool)(?:#function|\.Function)$|^TS(?:2339|18046|2322|2345)$/,
      message:
        /(?:^$|'function' does not exist on type 'ChatCompletion(?:MessageCustomToolCall|CustomTool)'|'[\w.?]*\.function' is of type 'unknown'|ChatCompletionMessageCustomToolCall|ChatCompletionCustomTool)/,
      guide:
        "A tool call is now `ChatCompletionMessageFunctionToolCall | ChatCompletionMessageCustomToolCall` (and a tool `ChatCompletionFunctionTool | ChatCompletionCustomTool`). Narrow with `if (call.type === 'function')` before reading `call.function`, or type the value as the function variant where the code only ever creates function tools. Decide explicitly what happens to a custom tool call (skip, reject or handle it) and say so; never cast it to the function shape.",
    },
    {
      id: 'function-output-union',
      summary:
        'function and custom tool call outputs in Responses can be content arrays, not only strings (6.0)',
      severity: 'breaking',
      kinds: ['type', 'signature', 'removed'],
      symbols:
        /(?:ResponseFunctionToolCallOutputItem|ResponseCustomToolCallOutput)#output$|^TS(?:2339|2322|2345)$/,
      message: /(?:^$|ResponseInput(?:Text|Image|File)\b)/,
      guide:
        '`ResponseFunctionToolCallOutputItem.output` and `ResponseCustomToolCallOutput.output` are `string | Array<ResponseInputText | ResponseInputImage | ResponseInputFile>`. Handle the array case (for text, join the `input_text` parts) where the code assumed a string; do not assert it is a string.',
    },
  ],
  behavior: openaiBehavior,
  instructions:
    'Sources pinned at openai 7.32.0, read 2026-10-14; see RESEARCH.md. Migrate only the reported site, from the compiler error and the guide above. Keep every model name, prompt, message, parameter value and request the code sends: the upgrade changes the SDK, not what the application asks the API. Never cast to any, suppress a diagnostic, or reshape data to the old types to get a clean compile. Where the guide offers options, choose one and report it under decisions.',
});
