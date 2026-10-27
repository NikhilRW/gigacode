export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

export const notFound = (what = 'resource') => new ApiError(404, 'not_found', `${what} not found`);
export const unauthorized = () => new ApiError(401, 'unauthorized', 'authentication required');
export const forbidden = () => new ApiError(403, 'forbidden', 'insufficient permissions');
export const unavailable = (what = 'service') => new ApiError(503, 'unavailable', `${what} temporarily unavailable`);

/** True for errors that mean "Postgres is unreachable", as opposed to a bad query. */
export function isDbConnectionError(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  if (!e) return false;
  if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', '57P01', '57P03', '08006', '08001'].includes(e.code ?? ''))
    return true;
  return /timeout exceeded when trying to connect|Connection terminated|connect ECONNREFUSED/i.test(e.message ?? '');
}
