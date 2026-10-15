import { z, type ZodError } from 'zod';

const schema = z.object({ email: z.string() });

// Shape of components/teams/add-team-member-modal.tsx in papermark: an inferred result.error.
export function firstMessage(input: unknown) {
  const validation = schema.safeParse(input);
  if (!validation.success) return validation.error.issues[0].message; // @uptide error-issues kind:removed path:ZodError#errors at:errors[0]
  return undefined;
}

export function optional(error?: ZodError) {
  return error?.issues?.length ?? 0; // @uptide error-issues kind:removed path:ZodError#errors at:errors?.
}

export function destructured(error: ZodError) {
  const { issues: errors } = error; // @uptide error-issues kind:removed path:ZodError#errors at:errors
  const { issues: list = [] } = error; // @uptide error-issues kind:removed path:ZodError#errors at:errors:
  return [...errors, ...list];
}

// Left alone: a write to the removed member is the agent's.
export function reset(error: ZodError) {
  error.errors = []; // @uptide error-issues keep kind:removed path:ZodError#errors at:errors
}

// Never reported: an object of the repository's own with an errors field.
export const form = { errors: ['required'] };
export const formErrors = form.errors;
