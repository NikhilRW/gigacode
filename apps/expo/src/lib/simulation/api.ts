import type { ApiClient } from '../client';
import type { ExecutionDetail, Me, Usage } from '../types';
import type { SimulationApi } from './controller';

/** Captures this exact client/session/origin. Never swaps credentials while draining. */
export function simulationApi(client: ApiClient): SimulationApi {
  return {
    origin: client.baseUrl,
    me: (signal) => client.request<Me>('GET', '/v1/me', { signal }),
    usage: (signal) => client.request<Usage>('GET', '/v1/usage', { signal }),
    create: (body) => client.request<{ id: string }>('POST', '/v1/executions', { body }),
    execution: (id, signal) => client.request<ExecutionDetail>('GET', `/v1/executions/${encodeURIComponent(id)}`, { signal }),
    cancel: async (id) => { await client.request('POST', `/v1/executions/${encodeURIComponent(id)}/cancel`); },
  };
}
