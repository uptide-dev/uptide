import { useFormik } from 'formik';
import { updateAccountSchema } from '@/lib/zod';

// Shape of components/account/UpdateName.tsx in boxyhq/saas-starter-kit: the file never
// imports zod; the schema comes from the repository's own module.
export const useName = (name: string) =>
  useFormik({
    initialValues: { name },
    validate: (values) => {
      try {
        updateAccountSchema.parse(values);
      } catch (error: any) {
        return error.formErrors.fieldErrors; // @uptide error-members at:error.formErrors path:ZodError#formErrors
      }
    },
    onSubmit: () => {},
  });

// Left alone: nothing in this try block parses with a schema.
export const save = async (send: () => Promise<void>) => {
  try {
    await send();
  } catch (error: any) {
    return error.formErrors.fieldErrors; // @uptide error-members keep at:error.formErrors path:ZodError#formErrors
  }
};
