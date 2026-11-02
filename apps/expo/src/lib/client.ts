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
        } catch { /* HTML from a private forwarding proxy is not an API error body. */ }
        if (response.status === 401 && !options.public) { this.unauthorized(); message = 'Your session expired. Sign in again; device drafts are safe.'; }
        if (response.status === 403) message += ' Check your permissions and Codespaces port visibility.';
        if (response.status === 429) message += ' Wait before trying again; tenant limits apply.';
        throw new ApiError(response.status, message, code, requestId);
      }
      if (response.status === 204) return undefined as T;
      if (options.text) return { text: await response.text(), truncated: response.headers.get('x-truncated') === 'true' } as T;
      return await response.json() as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (options.signal?.aborted) throw error;
      throw new ApiError(0, controller.signal.aborted ? 'The server took too long. Retry to check the latest state; a submitted run may still exist in History.' : 'Cannot reach the API. Check your connection, server URL, port visibility, and browser CORS settings.', 'network_error');
    } finally { clearTimeout(timeout); options.signal?.removeEventListener('abort', abort); }
  }
  async optional<T>(path: string, options: Options = {}): Promise<T | null> {
    try { return await this.request<T>('GET', path, options); } catch (error) { if (error instanceof ApiError && error.status === 404) return null; throw error; }
  }
}
