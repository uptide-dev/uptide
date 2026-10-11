import { z } from 'zod';
import { z as schema } from 'zod';
import * as validation from 'zod';

export const values = z.record(z.string(), z.unknown()).optional(); // @uptide record-key at:z.record path:record message:"Expected 2-3 arguments, but got 1."
export const renamed = schema.record(schema.string(), schema.number()); // @uptide record-key at:schema.record path:".":record message:"Expected 2-3 arguments, but got 1."
export const namespace = validation.record(validation.string(), validation.boolean()); // @uptide record-key at:validation.record path:TS2554 message:"Expected 2 arguments, but got 1."
export const commented = z.record(z.string(), /* value */ z.string(),); // @uptide record-key at:z.record path:TS2554 message:"Expected 2-3 arguments, but got 1."
export const explicit = z.record(z.string(), z.number()); // @uptide record-key keep at:z.record path:TS2554 message:"Expected 2-3 arguments, but got 1."
const args = [z.string(), z.number()] as const;
export const spread = z.record(...args); // @uptide record-key keep at:z.record path:TS2554 message:"Expected 2-3 arguments, but got 1."
export function shadow(z: { record(value: unknown): unknown }) {
  return z.record(1); // @uptide record-key keep at:z.record path:TS2554 message:"Expected 2-3 arguments, but got 1."
}
