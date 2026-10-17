import type { RefObject } from 'react';
import { useRef } from 'react';

interface Props {
  box: React.RefObject<HTMLDivElement>; // @uptide ref-object-nullable at:React.RefObject kind:type path:TS2322 message:"Type 'RefObject<HTMLDivElement | null>' is not assignable to type 'RefObject<HTMLDivElement>'."
  input: RefObject<HTMLInputElement>; // @uptide ref-object-nullable at:RefObject kind:type path:TS2322 message:"Type 'RefObject<HTMLInputElement | null>' is not assignable to type 'RefObject<HTMLInputElement>'."
  ready: React.RefObject<HTMLDivElement | null>; // @uptide ref-object-nullable keep at:React.RefObject
  count: React.RefObject<number>; // @uptide ref-object-nullable keep at:React.RefObject
  data: React.MutableRefObject<HTMLDivElement>;
}

export function useBounds<T extends HTMLElement>(ref: React.RefObject<T>) { // @uptide ref-object-nullable at:React.RefObject kind:type path:TS2322 message:"Type 'RefObject<T | null>' is not assignable to type 'RefObject<T>'."
  return ref;
}

export function useAny<T>(ref: React.RefObject<T>) {
  return ref;
}

export function Panel({ toolbar }: { toolbar: unknown }) {
  const own = useRef<HTMLDivElement>(null);
  // A cast compiles; there is nothing to edit.
  return [toolbar as RefObject<HTMLDivElement>, own]; // @uptide ref-object-nullable keep at:RefObject
}
