import OpenAI from 'openai';

const client = new OpenAI();
declare const traceId: string;

export const files = await client.files.list({ headers: { 'x-trace-id': traceId } }); // @uptide request-options at:{
export const batches = client.batches.list({ timeout: 10_000, maxRetries: 1 }); // @uptide request-options at:{

// Params, an explicit `{}` first, or not the SDK: left alone.
export const recent = await client.files.list({ purpose: 'batch', headers: {} }); // @uptide request-options keep at:{
export const explicit = await client.files.list({}, { headers: { 'x-trace-id': traceId } });
export const other = await fetchLater({ timeout: 1000 });
declare function fetchLater(options: { timeout: number }): Promise<void>;
