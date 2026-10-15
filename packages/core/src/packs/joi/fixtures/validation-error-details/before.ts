import { ValidationError } from 'joi';

export function missing(): ValidationError {
  const error = new ValidationError('Validation', {}, {}); // @uptide validation-error-details at:{}, path:TS2345 message:"Argument of type '{}' is not assignable to parameter of type 'ValidationErrorItem[]'."
  error.details = [];
  return error;
}

export const withOriginal = (user: unknown) => new ValidationError("Validation", { }, user); // @uptide validation-error-details at:{ }, path:TS2345 message:"Argument of type '{}' is not assignable to parameter of type 'ValidationErrorItem[]'."

// Items to rebuild, not an empty literal: the agent's, never rewritten.
export const listed = new ValidationError('Validation', { message: 'taken' }, {}); // @uptide validation-error-details keep at:{ path:TS2345 message:"Argument of type '{}' is not assignable to parameter of type 'ValidationErrorItem[]'."
// Already an array.
export const fine = new ValidationError('Validation', [], {}); // @uptide validation-error-details keep at:[] path:TS2345 message:"Argument of type '{}' is not assignable to parameter of type 'ValidationErrorItem[]'."
