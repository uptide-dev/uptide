import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';

const openai = new OpenAI();
const Answer = z.object({ answer: z.string() });
declare const tools: OpenAI.ChatCompletionTool[];
declare const functions: never[];

export const parsed = await openai.chat.completions.parse({ // @uptide beta-chat at:beta
  model: 'gpt-4o-2024-08-06',
  messages: [{ role: 'user', content: 'What is 2 + 2?' }],
  response_format: zodResponseFormat(Answer, 'answer'),
});
export const stream = openai.chat.completions // @uptide beta-chat at:beta
  .stream({ model: 'gpt-4o-mini', messages: [], stream: true });

const runner = (openai as any).chat.completions.runTools({ model: 'gpt-4o', messages: [], tools }); // @uptide beta-chat at:beta
runner.on('functionToolCall', (call: unknown) => console.log(call)); // @uptide runner-renames at:'functionCall'
runner.on("functionToolCallResult", (result: string) => console.log(result)); // @uptide runner-renames at:"functionCallResult"
export const last = await runner.finalFunctionToolCall(); // @uptide runner-renames at:finalFunctionCall
export const lastResult = await runner.finalFunctionToolCallResult(); // @uptide runner-renames at:finalFunctionCallResult

export const legacy = openai.beta.chat.completions.runFunctions({ model: 'gpt-4o', messages: [], functions }); // @uptide run-functions at:runFunctions

// Already 5.x, or not the runner: left alone.
runner.on('functionToolCall', (call: unknown) => console.log(call)); // @uptide runner-renames keep at:'functionToolCall'
process.on('message', () => undefined); // @uptide runner-renames keep at:'message'
export const assistant = await openai.beta.assistants.create({ model: 'gpt-4o' }); // @uptide beta-chat keep at:beta
export const plain = await openai.chat.completions.create({ model: 'gpt-4o', messages: [] }); // @uptide run-functions keep at:create
