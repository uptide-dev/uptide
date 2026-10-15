import { z } from 'zod';

export const user = z.object({
  name: z.string(),
  labels: z.record(z.string()),
  scores: z.record(z.number().int()),
});

export type User = z.infer<typeof user>;
