import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState } from 'react-native';
import { useAuth } from '@/state/AuthProvider';
import { describeError, type ApiClient } from './client';
import { terminal, type ExecutionDetail, type Result } from './types';

// Single-flight polling only while focused and foregrounded. Aborted/stale responses
// cannot overwrite another route, tenant, filter, or session's data.
const alwaysPoll = () => true;
export function useResource<T>(load: (api: ApiClient, signal: AbortSignal) => Promise<T>, interval = 0, enabled = true, shouldPoll: (value: T) => boolean = alwaysPoll) {
  const { api, me, signedIn } = useAuth();
  const userId = me?.user.id;
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  useFocusEffect(useCallback(() => {
    void revision; // Manual refresh intentionally restarts this focused subscription.
    let disposed = false, pending = false;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setData(undefined); setError(null);
    if (!enabled || !signedIn || !userId) { setLoading(false); return; }
    const tick = async () => {
      if (disposed || pending || AppState.currentState === 'background' || AppState.currentState === 'inactive') return;
      pending = true; controller = new AbortController(); setLoading(true);
      let repeat = true;
      try { const value = await load(api, controller.signal); if (!disposed && !controller.signal.aborted) { setData(value); setError(null); repeat = shouldPoll(value); } }
      catch (err) { if (!disposed && !controller.signal.aborted) setError(describeError(err)); }
      finally {
        pending = false;
        if (!disposed) { setLoading(false); if (repeat && interval > 0) timer = setTimeout(() => { void tick(); }, interval); }
      }
    };
    void tick();
    const listener = AppState.addEventListener('change', state => {
      if (timer) clearTimeout(timer);
      if (state === 'active') { void tick(); } else controller?.abort();
    });
    return () => { disposed = true; controller?.abort(); if (timer) clearTimeout(timer); listener.remove(); };
  }, [api, signedIn, userId, load, interval, enabled, revision, shouldPoll]));
  return { data, error, loading, reload: () => setRevision(value => value + 1) };
}
export function useGet<T>(path: string, query: Record<string, string | number | undefined> = {}, interval = 0, enabled = true) {
  const serialized = JSON.stringify(query);
  return useResource(useCallback((api: ApiClient, signal: AbortSignal) => api.request<T>('GET', path, { query: JSON.parse(serialized) as Record<string, string | number | undefined>, signal }), [path, serialized]), interval, enabled);
}
export type RunData = { execution: ExecutionDetail; result: Result | null; stdout: { text: string; truncated: boolean } | null; stderr: { text: string; truncated: boolean } | null };
const pollRun = (value: RunData) => value.execution.stale === true || !terminal(value.execution.status);
export function useLiveRun(id: string | null) {
  const load = useCallback(async (api: ApiClient, signal: AbortSignal): Promise<RunData> => {
    const path = `/v1/executions/${encodeURIComponent(id ?? '')}`;
    const execution = await api.request<ExecutionDetail>('GET', path, { signal });
    // Artifacts become available after terminal state; 404 is an explicit pending state.
    if (!terminal(execution.status)) return { execution, result: null, stdout: null, stderr: null };
    const [result, stdout, stderr] = await Promise.all([
      api.optional<Result>(`${path}/result`, { signal }),
      api.optional<{ text: string; truncated: boolean }>(`${path}/logs`, { query: { stream: 'stdout', inline: 'true' }, text: true, signal }),
      api.optional<{ text: string; truncated: boolean }>(`${path}/logs`, { query: { stream: 'stderr', inline: 'true' }, text: true, signal }),
    ]);
    return { execution, result, stdout, stderr };
  }, [id]);
  return useResource(load, 2500, !!id, pollRun);
}
