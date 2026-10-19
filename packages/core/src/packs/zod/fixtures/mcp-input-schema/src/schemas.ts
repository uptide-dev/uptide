import { z } from 'zod';

export const listShape = { resource: z.string(), top: z.string().optional() };
export const plainSchema = z.object({ id: z.string() });
export const strictSchema = z.object({ id: z.string() }).strict();
export const looseSchema = z.object({ id: z.string() }).passthrough();
export const neverCatchall = z.object({ id: z.string() }).catchall(z.never());

/** The human's helper in calmcp (`bdaef39`): the edit that keeps the old schema. */
export function strictInput<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).strict();
}
