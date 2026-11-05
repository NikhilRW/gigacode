import { z } from 'zod';

export const loginSchema = z.object({
  email: z.email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.').max(200),
});
export const signupSchema = loginSchema.extend({
  name: z
    .string()
    .trim()
    .min(2, 'Enter at least 2 characters.')
    .max(60, 'Keep your name under 60 characters.'),
  tenantName: z.string().trim().min(2, 'Enter a workspace name of at least 2 characters.').max(80),
  password: z.string().min(10, 'Use at least 10 characters.').max(200, 'Use no more than 200 characters.'),
});
