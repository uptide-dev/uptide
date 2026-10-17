import { z, type SafeParseReturnType, type ZodTypeDef } from 'zod'; // @uptide removed-exports at:SafeParseReturnType
import { ZodType } from 'zod';

// Shape of actions/event.ts in vzdc-artcc/website: a result typed with a zod 3 root export.
export const parse = (input: unknown): SafeParseReturnType<unknown, string> => // @uptide removed-exports at:SafeParseReturnType
  z.string().safeParse(input) as SafeParseReturnType<unknown, string>; // @uptide removed-exports at:SafeParseReturnType

export type Def = z.ZodTypeDef; // @uptide removed-exports at:z.ZodTypeDef
export type Shape = Record<string, import('zod').ZodEffects<z.ZodString>>; // @uptide removed-exports at:import('zod')
export const schema: ZodType = z.string();

// Left alone: a local type that shares the name, and a member that is not the export.
type SafeParseSuccess = { success: true };
export const ok = (value: SafeParseSuccess) => value.success; // @uptide removed-exports keep at:SafeParseSuccess
export const cap = z.string().safeParse('x').success; // @uptide removed-exports keep at:z.string
