import { describe, expect, test } from 'bun:test';
import { loginSchema, signupSchema } from '../src/lib/auth';

describe('account form validation', () => {
  test('sign-in requires a real email format and a non-empty password', () => {
    expect(loginSchema.safeParse({ email: 'not-an-email', password: '' }).success).toBe(false);
    // Do not impose new sign-up password rules on an existing account.
    expect(loginSchema.safeParse({ email: 'ada@example.com', password: 'legacy' }).success).toBe(true);
  });
  test('sign-up validates name and password length', () => {
    expect(
      signupSchema.safeParse({ name: ' ', tenantName: 'Study', email: 'ada@example.com', password: 'short' })
        .success,
    ).toBe(false);
    expect(
      signupSchema.parse({
        name: '  Ada  ',
        tenantName: '  Study  ',
        email: 'ada@example.com',
        password: 'a-long-password',
      }),
    ).toMatchObject({ name: 'Ada', tenantName: 'Study' });
    expect(
      signupSchema.safeParse({ name: 'Ada', email: 'ada@example.com', password: 'a-long-password' }).success,
    ).toBe(false);
  });
});
