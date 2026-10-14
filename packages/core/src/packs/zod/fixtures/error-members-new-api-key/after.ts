import { z, ZodError } from 'zod';
import { createApiKeySchema } from '@/lib/zod';

// Shape of components/apiKey/NewAPIKey.tsx in boxyhq/saas-starter-kit: a formik validate.
export const validate = (values: z.infer<typeof createApiKeySchema>) => {
  try {
    createApiKeySchema.parse(values);
  } catch (error: any) {
    return z.flattenError(error).fieldErrors; // @uptide error-members at:error.formErrors path:ZodError#formErrors
  }
};

// Left alone: narrowed to ZodError, the compiler reports this read itself.
export const narrowed = (values: unknown) => {
  try {
    createApiKeySchema.parse(values);
  } catch (error) {
    if (error instanceof ZodError) return error.formErrors.fieldErrors; // @uptide error-members keep at:error.formErrors path:ZodError#formErrors
  }
};
