import type { ZodType, ZodTypeDef } from 'zod';
import { ApiError } from '../errors.ts';

export function parseBody<T>(schema: ZodType<T, ZodTypeDef, unknown>, body: unknown): T {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    throw new ApiError(400, 'validation_error', `${where}${issue?.message ?? 'invalid request'}`);
  }
  return result.data;
}

export function parseParams<T>(schema: ZodType<T, ZodTypeDef, unknown>, value: unknown): T {
  return parseBody(schema, value);
}
