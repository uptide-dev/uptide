import OpenAI from 'openai';

const client = new OpenAI();
declare const threadId: string;
declare const runId: string;
declare const thread_id: string;
declare const outputs: { tool_call_id: string; output: string }[];

export const run = await client.beta.threads.runs.retrieve(runId, { thread_id: threadId }); // @uptide named-path-params at:retrieve
export const cancelled = await client.beta.threads.runs.cancel(runId, { thread_id: threadId }, { timeout: 5000 }); // @uptide named-path-params at:cancel
export const submitted = await client.beta.threads.runs.submitToolOutputs(runId, { thread_id: threadId, tool_outputs: outputs }); // @uptide named-path-params at:submitToolOutputs
export const polled = await client.beta.threads.runs.submitToolOutputsAndPoll( // @uptide named-path-params at:submitToolOutputsAndPoll
  runId,
  {
    thread_id: threadId,
    tool_outputs: outputs,
  },
);
export const message = await client.beta.threads.messages.retrieve('msg_1', { thread_id }); // @uptide named-path-params at:retrieve
export const step = await client.beta.threads.runs.steps.retrieve('step_1', { thread_id: threadId, run_id: runId }); // @uptide named-path-params at:retrieve
export const file = await client.vectorStores.files.retrieve('file_1', { vector_store_id: 'vs_1' }); // @uptide named-path-params at:retrieve
export const removed = await client.vectorStores.files.delete('file_1', { vector_store_id: 'vs_1' }); // @uptide named-path-params at:del
export const item = await client.evals.runs.outputItems.retrieve('item_1', { eval_id: 'eval_1', run_id: 'run_1' }); // @uptide named-path-params at:retrieve

// Already in the 5.x shape, and methods whose single id did not change: left alone.
export const again = await client.beta.threads.runs.retrieve(runId, { thread_id: threadId }); // @uptide named-path-params keep at:retrieve
export const listed = client.beta.threads.runs.list(threadId);
export const created = await client.beta.threads.runs.create(threadId, { assistant_id: 'asst_1' });
export const fileOnly = await client.files.retrieve('file_1');
