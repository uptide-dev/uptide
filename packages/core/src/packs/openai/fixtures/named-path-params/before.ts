import OpenAI from 'openai';

const client = new OpenAI();
declare const threadId: string;
declare const runId: string;
declare const thread_id: string;
declare const outputs: { tool_call_id: string; output: string }[];

export const run = await client.beta.threads.runs.retrieve(threadId, runId); // @uptide named-path-params at:retrieve
export const cancelled = await client.beta.threads.runs.cancel(threadId, runId, { timeout: 5000 }); // @uptide named-path-params at:cancel
export const submitted = await client.beta.threads.runs.submitToolOutputs(threadId, runId, { tool_outputs: outputs }); // @uptide named-path-params at:submitToolOutputs
export const polled = await client.beta.threads.runs.submitToolOutputsAndPoll( // @uptide named-path-params at:submitToolOutputsAndPoll
  threadId,
  runId,
  {
    tool_outputs: outputs,
  },
);
export const message = await client.beta.threads.messages.retrieve(thread_id, 'msg_1'); // @uptide named-path-params at:retrieve
export const step = await client.beta.threads.runs.steps.retrieve(threadId, runId, 'step_1'); // @uptide named-path-params at:retrieve
export const file = await client.vectorStores.files.retrieve('vs_1', 'file_1'); // @uptide named-path-params at:retrieve
export const removed = await client.vectorStores.files.del('vs_1', 'file_1'); // @uptide named-path-params at:del
export const item = await client.evals.runs.outputItems.retrieve('eval_1', 'run_1', 'item_1'); // @uptide named-path-params at:retrieve

// Already in the 5.x shape, and methods whose single id did not change: left alone.
export const again = await client.beta.threads.runs.retrieve(runId, { thread_id: threadId }); // @uptide named-path-params keep at:retrieve
export const listed = client.beta.threads.runs.list(threadId);
export const created = await client.beta.threads.runs.create(threadId, { assistant_id: 'asst_1' });
export const fileOnly = await client.files.retrieve('file_1');
