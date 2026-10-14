import { z } from 'zod';
import { updateTeamSchema } from '@/lib/zod';

// Shape of components/team/TeamSettings.tsx in boxyhq/saas-starter-kit: a formik validate.
export const validate = (values: z.infer<typeof updateTeamSchema>) => {
  try {
    updateTeamSchema.parse(values);
  } catch (error: any) {
    return z.flattenError(error).fieldErrors; // @uptide error-members at:error.formErrors path:ZodError#formErrors
  }
};

// Left alone: what is caught here is not a zod error.
export const settings = (raw: string) => {
  try {
    return JSON.parse(raw);
  } catch (error: any) {
    return error.formErrors.fieldErrors; // @uptide error-members keep at:error.formErrors path:ZodError#formErrors
  }
};
