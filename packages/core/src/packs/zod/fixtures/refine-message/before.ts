import { z } from 'zod';

// Shape of actions/event.ts in vzdc-artcc/website: a refinement with a message option.
export const event = z
  .object({ start: z.date(), end: z.date() })
  .refine((e) => e.end > e.start, {
    message: 'End must follow start.', // @uptide refine-message at:message
    path: ['end'],
  });
export const loa = z.object({ n: z.number() }).refine((v) => v.n > 0, { message: 'Positive.' }); // @uptide refine-message at:message

// Left alone: a string, the new option, and a refine that is not zod's.
export const a = z.string().refine((v) => v.length > 0, 'Required'); // @uptide refine-message keep at:refine
export const b = z.string().refine((v) => v.length > 0, { error: 'Required' }); // @uptide refine-message keep at:refine
export const c = z.string().refine((v) => v.length > 0); // @uptide refine-message keep at:refine
