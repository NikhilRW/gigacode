import { z } from 'zod';

export const loginSchema = z.object({
  email: z.email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});
export const signupSchema = loginSchema.extend({
  name: z.string().trim().min(2, 'Enter at least 2 characters.').max(60, 'Keep your name under 60 characters.'),
  password: z.string().min(8, 'Use at least 8 characters.').max(128, 'Use no more than 128 characters.'),
});
export const connectionMessage = 'The account service is not connected yet. No account was created and you are not signed in. You can keep coding and save drafts on this device.';

// Deliberately does not accept, transmit, log, or persist credentials before a real service exists.
export async function requireAccountService(): Promise<never> {
  throw new Error(connectionMessage);
}
