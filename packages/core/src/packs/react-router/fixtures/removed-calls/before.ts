import { json, defer, AbortedDeferredError as Aborted, type LoaderFunctionArgs } from 'react-router-dom'; // @uptide dom-imports at:'react-router-dom'

export async function loader({ params }: LoaderFunctionArgs) {
  if (!params.id) throw json({ message: 'missing id' }, { status: 400 }); // @uptide removed-json at:json
  return json({ id: params.id }); // @uptide removed-json at:json
}

export function slow() {
  return defer({ list: Promise.resolve([]) }); // @uptide removed-defer at:defer
}

export function isAborted(error: unknown) {
  return error instanceof Aborted; // @uptide removed-defer at:Aborted
}

export function local() {
  const json = (value: unknown) => JSON.stringify(value);
  return json({ kept: true }); // @uptide removed-json keep at:json
}

export const body = JSON.stringify({ json: 1 }); // @uptide removed-json keep at:JSON
export const parse = (r: Response) => r.json(); // @uptide removed-json keep at:r.json

export function later(run: () => void) {
  const defer = (fn: () => void) => setTimeout(fn);
  return defer(run); // @uptide removed-defer keep at:defer
}
