import type { User } from '@prisma/client';
import { updateAccountSchema } from '@/lib/zod';

// Shape of components/account/UpdateEmail.tsx in boxyhq/saas-starter-kit.
export const validate = (values: Pick<User, 'email'>) => {
  try {
    updateAccountSchema.parse(values);
  } catch (error: any) {
    return error.formErrors.fieldErrors; // @uptide error-members at:error.formErrors path:ZodError#formErrors
  }
};

// Left alone: a typed error is the compiler's to report, not this rule's.
export const typed = (values: unknown) => {
  const result = updateAccountSchema.safeParse(values);
  return result.success ? undefined : result.error.formErrors.formErrors; // @uptide error-members keep at:result.error.formErrors path:ZodError#formErrors
};
