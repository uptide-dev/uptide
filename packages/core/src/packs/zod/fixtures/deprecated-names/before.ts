import { z, type ZodRawShape, type ZodTypeAny } from 'zod'; // @uptide deprecated-names at:ZodTypeAny

// Shape of packages/sdk/src/mcp/zod.ts in band-ai/band-sdk-typescript.
export function toShape(): Record<string, import('zod').ZodTypeAny> { // @uptide deprecated-names at:import('zod')
  const shape: Record<string, ZodTypeAny> = {}; // @uptide deprecated-names at:ZodTypeAny
  return shape;
}
export const issue = (i: z.ZodIssue) => i.message; // @uptide deprecated-names at:z.ZodIssue
export type Raw = ZodRawShape; // @uptide deprecated-names keep at:ZodRawShape

// Left alone: a local type with the name, and the replacement.
type ZodSchema = { local: true };
export const local: ZodSchema = { local: true }; // @uptide deprecated-names keep at:ZodSchema
export const ok = (t: z.ZodType) => t; // @uptide deprecated-names keep at:z.ZodType
