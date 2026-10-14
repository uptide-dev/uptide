import OpenAI, { fileFromPath } from 'openai'; // @uptide file-from-path at:fileFromPath

const openai = new OpenAI();
declare const jobs: any;

// Typed `any` or `unknown`: the compiler cannot see these 4.x reads.
export async function retryAfter(prompt: string): Promise<string | undefined> {
  try {
    await openai.chat.completions.create({ model: 'gpt-4o', messages: [{ role: 'user', content: prompt }] });
  } catch (e: any) {
    const wait = e.headers['retry-after']; // @uptide error-headers at:headers
    const id = e.headers?.['x-request-id']; // @uptide error-headers at:headers
    return wait ?? id;
  }
  return undefined;
}

export async function download(id: string) {
  const res = await openai.files.content(id).asResponse();
  res.body.pipe(process.stdout); // @uptide web-response at:pipe
  const { response } = await openai.models.list().withResponse();
  return response.headers.raw(); // @uptide web-response at:raw
}

export const file = await openai.files.retrieve(encodeURIComponent('file/1')); // @uptide encoded-path-params at:encodeURIComponent
export const upload = await openai.files.create({ file: await OpenAI.fileFromPath('data.jsonl'), purpose: 'batch' }); // @uptide file-from-path at:fileFromPath
export const next = jobs.nextPageParams(); // @uptide page-helpers at:nextPageParams

// Read the 5.x way, or not the SDK's: left alone.
export async function handled() {
  try {
    await openai.models.list();
  } catch (e: any) {
    return e.headers.get('retry-after');
  }
  const request = new Request('https://example.com');
  return request.headers.get('x');
}
export const search = await fetch(`https://example.com/${encodeURIComponent('a b')}`);
declare const helpers: { fileFromPath(path: string): Promise<Blob> };
export const local = await helpers.fileFromPath('data.jsonl'); // @uptide file-from-path keep at:fileFromPath
export const following = await jobs.getNextPage(); // @uptide page-helpers keep at:getNextPage
