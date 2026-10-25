import { describe, expect, test } from 'bun:test';
import { connectionMessage, loginSchema, requireAccountService, signupSchema } from '../src/lib/auth';

describe('account forms without a backend', () => {
  test('sign-in requires a real email format and a non-empty password', () => {
    expect(loginSchema.safeParse({ email: 'not-an-email', password: '' }).success).toBe(false);
    // Do not impose new sign-up password rules on an existing account.
    expect(loginSchema.safeParse({ email: 'ada@example.com', password: 'legacy' }).success).toBe(true);
  });
  test('sign-up validates name and password length', () => {
    expect(signupSchema.safeParse({ name: ' ', email: 'ada@example.com', password: 'short' }).success).toBe(false);
    expect(signupSchema.parse({ name: '  Ada  ', email: 'ada@example.com', password: 'a-long-password' }).name).toBe('Ada');
  });
  test('never fabricates a successful session', async () => {
    await expect(requireAccountService()).rejects.toThrow(connectionMessage);
  });
});
