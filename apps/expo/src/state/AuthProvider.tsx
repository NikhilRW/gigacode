import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import { z } from 'zod';
import { ApiClient, describeError, normalizeApiUrl, type Credential } from '@/lib/client';
import { readCredential, writeCredential } from '@/lib/credentialStore';
import type { Me, NativeSession } from '@/lib/types';

const urlKey = 'gigacode.api-url.v1';
const meSchema = z.object({
  user: z.object({
    id: z.string(),
    email: z.string(),
    name: z.string().nullable(),
    role: z.enum(['owner', 'member', 'platform_admin']),
  }),
  tenant: z.object({ id: z.string(), name: z.string() }),
  limits: z.object({
    maxConcurrent: z.number(),
    maxExecPerMin: z.number(),
    maxTimeoutMs: z.number(),
    maxMemoryMb: z.number(),
    maxSourceBytes: z.number(),
  }),
});
const sessionSchema = meSchema.extend({
  token: z.string().startsWith('ce_session_'),
  expiresIn: z.number().positive(),
});
type Auth = {
  api: ApiClient;
  baseUrl: string;
  ready: boolean;
  me: Me | null;
  signedIn: boolean;
  error: string | null;
  refreshMe: () => Promise<void>;
  login: (
    body: { email: string; password: string; name?: string; tenantName?: string },
    register?: boolean,
  ) => Promise<void>;
  logout: () => Promise<void>;
  setServer: (url: string) => Promise<void>;
};
const Context = createContext<Auth | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [baseUrl, setBaseUrl] = useState('');
  const [credential, setCredential] = useState<Credential | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const currentCredential = useRef<Credential | null>(null);
  const storageQueue = useRef(Promise.resolve());
  const persist = useCallback((value: Credential | null) => {
    const next = storageQueue.current.catch(() => undefined).then(() => writeCredential(value));
    storageQueue.current = next;
    return next;
  }, []);
  const clear = useCallback(() => {
    generation.current++;
    currentCredential.current = null;
    setCredential(null);
    setMe(null);
    return persist(null);
  }, [persist]);
  const onUnauthorized = useCallback(() => {
    if (credential && currentCredential.current?.token === credential.token) {
      void clear().catch(() =>
        setError(
          'Signed out here, but stored credentials could not be removed. Retry Sign out in Connection settings.',
        ),
      );
      setError('Your session expired. Please sign in again. Your drafts are safe.');
    }
  }, [credential, clear]);
  // ApiClient only stores this callback; it never invokes it during construction/render.
  // eslint-disable-next-line react-hooks/refs
  const api = useMemo(() => new ApiClient(baseUrl, credential, onUnauthorized), [baseUrl, credential, onUnauthorized]);
  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const storedUrl = await AsyncStorage.getItem(urlKey);
        const url = storedUrl || process.env.EXPO_PUBLIC_API_URL || '';
        const base = url ? normalizeApiUrl(url) : '';
        const saved = await readCredential();
        if (disposed) return;
        setBaseUrl(base);
        if (saved && saved.baseUrl === base) {
          currentCredential.current = saved;
          setCredential(saved);
        }
      } catch (err) {
        if (!disposed) setError(`Could not restore connection/session: ${describeError(err)}`);
      } finally {
        if (!disposed) setReady(true);
      }
    })();
    return () => {
      disposed = true;
    };
  }, []);
  const refreshMe = useCallback(async () => {
    if (!credential) return;
    const version = generation.current;
    try {
      const value = meSchema.parse(await api.request<Me>('GET', '/v1/me'));
      if (version === generation.current) {
        setMe(value);
        setError(null);
      }
    } catch (err) {
      if (version === generation.current) setError(describeError(err));
    }
  }, [api, credential]);
  useEffect(() => {
    if (!ready || !credential) return;
    const initial = setTimeout(() => {
      void refreshMe();
    }, 0);
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshMe();
    });
    const timer = setTimeout(
      () => {
        void clear().catch((err) => setError(describeError(err)));
        setError('Your session expired. Sign in again.');
      },
      Math.min(2147483647, Math.max(0, credential.expiresAt - Date.now())),
    );
    return () => {
      listener.remove();
      clearTimeout(timer);
      clearTimeout(initial);
    };
  }, [ready, credential, refreshMe, clear]);
  const login: Auth['login'] = async (body, register = false) => {
    const version = ++generation.current;
    const response = sessionSchema.parse(
      await api.request<NativeSession>('POST', `/v1/auth/native/${register ? 'register' : 'login'}`, {
        public: true,
        body,
      }),
    );
    if (version !== generation.current) throw new Error('Connection changed. Sign in again.');
    const next = { token: response.token, expiresAt: Date.now() + response.expiresIn * 1000, baseUrl };
    await persist(next); // Storage failure must not masquerade as a durable successful sign-in.
    if (version !== generation.current) return;
    currentCredential.current = next;
    setCredential(next);
    setMe(meSchema.parse(response));
    setError(null);
  };
  const logout = async () => {
    await clear();
    setError(null);
  };
  const setServer = async (input: string) => {
    const next = normalizeApiUrl(input);
    await clear(); // Never forward a token from one origin to another.
    await AsyncStorage.setItem(urlKey, next);
    setBaseUrl(next);
    setError(null);
  };
  return (
    <Context.Provider
      value={{ api, baseUrl, ready, me, signedIn: !!credential, error, refreshMe, login, logout, setServer }}
    >
      {children}
    </Context.Provider>
  );
}
export function useAuth() {
  const value = useContext(Context);
  if (!value) throw new Error('useAuth requires AuthProvider');
  return value;
}
