import { z } from 'zod';

// Shape of packages/schema/src/nodes.ts in howardyang2009/PATH.
const unknownStep = (_issue: unknown, ctx: { defaultError: string }) => ({ message: ctx.defaultError }); // @uptide error-map at:defaultError
export const node = z.union(
  [z.string(), z.number()],
  { errorMap: unknownStep }, // @uptide error-map at:errorMap
);

// Left alone: the zod 4 option, and an errorMap property that is no call's option.
export const next = z.string({ error: () => 'no' });
export const registry = { errorMap: unknownStep }; // @uptide error-map keep at:errorMap
