import OpenAI from 'openai';

const openai = new OpenAI();
declare const assistantId: string;
declare const cache: { files: { del(key: string): void } };
declare const redis: { del(key: string): Promise<number> };

export const assistant = await openai.beta.assistants.delete(assistantId); // @uptide delete-method at:del
export const file = await openai.files.delete('file_1'); // @uptide delete-method at:del
export const store = await openai.vectorStores.delete('vs_1', { timeout: 1000 }); // @uptide delete-method at:del
export const completion = await openai.chat.completions.delete('chatcmpl_1'); // @uptide delete-method at:del

class Uploader {
  constructor(private client: OpenAI) {}
  remove(id: string) {
    return this.client.files.delete(id); // @uptide delete-method at:del
  }
}
export { Uploader };

// Not the SDK: a `files.del` on something that is not a client, and another library's `del`.
cache.files.del('key'); // @uptide delete-method keep at:del
await redis.del('key'); // @uptide delete-method keep at:del
