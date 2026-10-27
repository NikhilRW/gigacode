import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isTerminal } from '@shared/states.ts';
import { api } from '../api/endpoints.ts';

/**
 * Execution detail kept live: SSE (cookie auth) triggers refetches; if the stream
 * fails, fall back to polling every second until the execution is terminal.
 */
export function useLiveExecution(id: string | null) {
  const qc = useQueryClient();
  const [polling, setPolling] = useState(false);

  const query = useQuery({
    queryKey: ['execution', id],
    queryFn: () => api.getExecution(id!),
    enabled: !!id,
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      if (status && isTerminal(status)) return false;
      return polling ? 1000 : false;
    },
  });

  const status = query.data?.status;
  const terminal = !!status && isTerminal(status);

  useEffect(() => {
    if (!id || terminal || typeof EventSource === 'undefined') {
      if (id && !terminal) setPolling(true);
      return;
    }
    setPolling(false);
    const es = new EventSource(`/v1/executions/${encodeURIComponent(id)}/events`, { withCredentials: true });
    es.addEventListener('status', () => {
      void qc.invalidateQueries({ queryKey: ['execution', id] });
    });
    es.onerror = () => {
      // Server closes the stream on terminal state; either way, refetch and poll if still active.
      es.close();
      void qc.invalidateQueries({ queryKey: ['execution', id] });
      setPolling(true);
    };
    return () => es.close();
  }, [id, terminal, qc]);

  return query;
}
