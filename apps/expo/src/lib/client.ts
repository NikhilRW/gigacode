export function normalizeApiUrl(input: string): string {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error('Enter a full API URL, for example https://your-codespace-3000.app.github.dev'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('Use an http(s) server origin only, without credentials, path, query, or fragment.');
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]' || url.hostname === '10.0.2.2' || /^192\.168\.\d+\.\d+$/.test(url.hostname) || /^10\.\d+\.\d+\.\d+$/.test(url.hostname) || /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(url.hostname);
  if (url.protocol !== 'https:' && !local) throw new Error('Use HTTPS for remote servers. HTTP is allowed only for local development.');
  return url.origin;
}
export class ApiError extends Error {
  constructor(public status: number, message: string, public code = 'request_failed', public requestId?: string) { super(message); this.name = 'ApiError'; }
}
export const describeError = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';

export function getBrowserOrigin(): string | null {
  return typeof window !== 'undefined' && typeof window.location?.origin === 'string'
    ? window.location.origin
    : null;
}

function transportError(error: unknown, url: string, timedOut: boolean): ApiError {
  const origin = getBrowserOrigin();
  const reason = error instanceof Error ? `${error.name}: ${error.message}` : 'No readable network response';
  const message = timedOut
    ? `The API request timed out: ${url}. A submitted run may still exist in History.`
    : `Cannot reach the API at ${url}. ${reason}.`;
  const browserHint = origin
    ? ` Browser origin: ${origin}. The API must allow this exact origin in WEB_ORIGIN. HTTPS pages also need an HTTPS API.`
    : '';
  // Report only public request information, never bodies, passwords or credentials.
  console.warn('GigaCode API connection failed', { url, browserOrigin: origin, reason });
  return new ApiError(0, `${message}${browserHint} For Codespaces, verify port 3000 is Public.`, timedOut ? 'request_timeout' : 'network_error');
}

async function readJson(response: Response): Promise<unknown> {
  const type = response.headers.get('content-type') ?? '';
  if (!/(?:application\/json|\+json)(?:\s*;|$)/i.test(type)) {
    throw new ApiError(response.status, `The server responded with ${type || 'an unknown content type'} instead of API JSON (HTTP ${response.status}). Check that this is API port 3000. A private Codespaces port may serve GitHub login HTML.`, 'invalid_response');
  }
  try { return await response.json(); }
  catch { throw new ApiError(response.status, `The API returned unreadable JSON (HTTP ${response.status}).`, 'invalid_response'); }
}

export interface ConnectionReport {
  url: string;
  httpStatus: number;
  readiness: 'ready' | 'degraded';
  postgres: string;
  redis: string;
  s3: string;
}

/** Public readiness request, using JSON headers so browsers perform the CORS preflight. */
export async function checkApiConnection(input: string): Promise<ConnectionReport> {
  const url = `${normalizeApiUrl(input)}/readyz`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      credentials: 'omit', redirect: 'error', signal: controller.signal,
    });
    const data = await readJson(response);
    if (!data || typeof data !== 'object' || !('status' in data) || (data.status !== 'ready' && data.status !== 'degraded')) {
      throw new ApiError(response.status, `The URL responded, but it is not GigaCode's readiness endpoint (HTTP ${response.status}). Use the API origin on port 3000.`, 'invalid_response');
    }
    const record = data as Record<string, unknown>;
    const service = (name: string) => typeof record[name] === 'string' ? String(record[name]) : 'unknown';
    if (!response.ok && response.status !== 503) throw new ApiError(response.status, `Readiness returned HTTP ${response.status}.`, 'request_failed');
    return { url, httpStatus: response.status, readiness: data.status, postgres: service('postgres'), redis: service('redis'), s3: service('s3') };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw transportError(error, url, controller.signal.aborted);
  } finally { clearTimeout(timer); }
}
type Options = { body?: unknown; query?: Record<string, string | number | undefined>; signal?: AbortSignal; text?: boolean; public?: boolean };
export type Credential = { token: string; expiresAt: number; baseUrl: string };
export class ApiClient {
  constructor(readonly baseUrl: string, private credential: Credential | null, private unauthorized: () => void, private fetcher: typeof fetch = fetch) {}
  async request<T>(method: string, path: string, options: Options = {}): Promise<T> {
    if (!this.baseUrl) throw new ApiError(0, 'Set your API server URL in Connection settings first.', 'not_configured');
    if (!path.startsWith('/v1/')) throw new Error('Only /v1 API paths are allowed.');
    const base = normalizeApiUrl(this.baseUrl);
    const url = new URL(path, base);
    for (const [key, value] of Object.entries(options.query ?? {})) if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    const headers: Record<string, string> = { Accept: options.text ? 'text/plain' : 'application/json' };
    if (!options.public) {
      if (!this.credential || this.credential.baseUrl !== base || this.credential.expiresAt <= Date.now()) {
        this.unauthorized(); throw new ApiError(401, 'Your session expired. Sign in again; device drafts are safe.', 'session_expired');
      }
      headers.Authorization = `Bearer ${this.credential.token}`;
    }
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) controller.abort();
    const timeout = setTimeout(abort, 20000);
    try {
      const response = await this.fetcher(url.toString(), { method, headers, credentials: 'omit', redirect: 'error', body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: controller.signal });
      if (!response.ok) {
        let message = `Request failed (${response.status}).`, code = 'request_failed', requestId = response.headers.get('x-request-id') ?? undefined;
        try {
          const data: unknown = await response.json();
          if (typeof data === 'object' && data && 'error' in data && typeof data.error === 'object' && data.error) {
            if ('message' in data.error && typeof data.error.message === 'string') message = data.error.message;
            if ('code' in data.error && typeof data.error.code === 'string') code = data.error.code;
            if ('requestId' in data.error && typeof data.error.requestId === 'string') requestId = data.error.requestId;
          }
        } catch {
          const type = response.headers.get('content-type') ?? '';
          if (type.includes('text/html')) message += ' Received HTML instead of API JSON. Verify API port 3000 and Codespaces Public visibility.';
        }
        if (response.status === 401 && !options.public) { this.unauthorized(); message = 'Your session expired. Sign in again; device drafts are safe.'; }
        if (response.status === 403) message += ' Check your permissions and Codespaces port visibility.';
        if (response.status === 429) message += ' Wait before trying again; tenant limits apply.';
        throw new ApiError(response.status, message, code, requestId);
      }
      if (response.status === 204) return undefined as T;
      if (options.text) return { text: await response.text(), truncated: response.headers.get('x-truncated') === 'true' } as T;
      return await readJson(response) as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (options.signal?.aborted) throw error;
      throw transportError(error, `${base}${path}`, controller.signal.aborted);
    } finally { clearTimeout(timeout); options.signal?.removeEventListener('abort', abort); }
  }
  async optional<T>(path: string, options: Options = {}): Promise<T | null> {
    try { return await this.request<T>('GET', path, options); } catch (error) { if (error instanceof ApiError && error.status === 404) return null; throw error; }
  }
}
