import type { ErrorBody } from '@engine/shared';

let csrfToken: string | null = null;

/** The CSRF token comes from Me and lives only in memory. */
export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | undefined | null>;

interface RequestOptions {
  body?: unknown;
  query?: Query;
}

function buildUrl(path: string, query?: Query): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/** Paths where a 401 is an expected answer, not a reason to redirect. */
const NO_REDIRECT = ['/v1/auth/', '/v1/me'];

async function send(method: string, path: string, opts: RequestOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['x-csrf-token'] = csrfToken;

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      credentials: 'include',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network_error', 'Cannot reach the server. Check your connection and try again.');
  }

  if (!res.ok) {
    let body: Partial<ErrorBody> = {};
    try {
      body = (await res.json()) as ErrorBody;
    } catch {
      /* non-JSON error body */
    }
    const retryAfter = Number(res.headers.get('retry-after') ?? '') || undefined;
    const err = new ApiError(
      res.status,
      body.error?.code ?? `http_${res.status}`,
      body.error?.message ?? res.statusText ?? 'Request failed',
      body.error?.requestId ?? res.headers.get('x-request-id') ?? undefined,
      retryAfter,
    );
    if (res.status === 401 && !NO_REDIRECT.some((p) => path.startsWith(p)) && window.location.pathname !== '/login') {
      window.location.assign('/login');
    }
    throw err;
  }
  return res;
}

export async function request<T>(method: string, path: string, opts?: RequestOptions): Promise<T> {
  const res = await send(method, path, opts);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function requestText(path: string, query?: Query): Promise<{ text: string; headers: Headers }> {
  const res = await send('GET', path, { query });
  return { text: await res.text(), headers: res.headers };
}

/** Human-readable message for any error thrown by the client. */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return err.message;
    if (err.status === 429)
      return `Rate limited: ${err.message}${err.retryAfterSeconds ? ` Retry in ${err.retryAfterSeconds}s.` : ''}`;
    // A bad password at sign-in is not an expired session; show the server's own wording for that.
    if (err.status === 401 && err.code !== 'invalid_credentials') return 'Your session has expired. Please sign in again.';
    if (err.status >= 500)
      return `Server error (${err.code}). Please try again.${err.requestId ? ` Request id: ${err.requestId}` : ''}`;
    return err.message;
  }
  return err instanceof Error ? err.message : 'Unexpected error';
}
