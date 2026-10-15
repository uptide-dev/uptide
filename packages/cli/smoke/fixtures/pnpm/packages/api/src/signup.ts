import { z } from 'zod';

export const signup = z.object({
  email: z.string().min(3),
  plan: z.enum(['free', 'pro']),
  metadata: z.record(z.string()),
  limits: z.record(z.number()),
});

export type Signup = z.infer<typeof signup>;
