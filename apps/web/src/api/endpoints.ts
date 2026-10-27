import type {
  AdminTenant,
  ApiKey,
  CreateExecutionInput,
  CreatedApiKey,
  Execution,
  ExecutionDetail,
  ExecutionList,
  ExecutionStatus,
  LanguageId,
  Limits,
  Me,
  QueueStats,
  ResultFile,
  TenantLimitsPatch,
  Usage,
  WorkerInfo,
} from '@engine/shared';
import { ApiError, request, requestText, setCsrfToken } from './client.ts';

async function withCsrf(p: Promise<Me>): Promise<Me> {
  const me = await p;
  setCsrfToken(me.csrfToken);
  return me;
}

export interface ExecutionSource {
  language: LanguageId;
  entryFile: string;
  files: { path: string; content: string }[];
  stdin: string;
  limits: Limits;
}

export interface ListFilters {
  status?: ExecutionStatus;
  language?: LanguageId;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

export const api = {
  me: () => withCsrf(request<Me>('GET', '/v1/me')),
  login: (body: { email: string; password: string }) => withCsrf(request<Me>('POST', '/v1/auth/login', { body })),
  register: (body: { tenantName: string; email: string; password: string }) =>
    withCsrf(request<Me>('POST', '/v1/auth/register', { body })),
  logout: async () => {
    await request<void>('POST', '/v1/auth/logout');
    setCsrfToken(null);
  },

  usage: () => request<Usage>('GET', '/v1/usage'),

  listExecutions: (f: ListFilters) =>
    request<ExecutionList>('GET', '/v1/executions', { query: { ...f } as Record<string, string | number | undefined> }),
  getExecution: (id: string) => request<ExecutionDetail>('GET', `/v1/executions/${encodeURIComponent(id)}`),
  getSource: (id: string) => request<ExecutionSource>('GET', `/v1/executions/${encodeURIComponent(id)}/source`),
  createExecution: (body: CreateExecutionInput) =>
    request<{ id: string; status: ExecutionStatus }>('POST', '/v1/executions', { body }),
  cancelExecution: (id: string) => request<Execution>('POST', `/v1/executions/${encodeURIComponent(id)}/cancel`),
  getResult: async (id: string): Promise<ResultFile | null> => {
    try {
      return await request<ResultFile>('GET', `/v1/executions/${encodeURIComponent(id)}/result`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  },
  getLogs: async (id: string, stream: 'stdout' | 'stderr'): Promise<{ text: string; truncated: boolean } | null> => {
    try {
      const { text, headers } = await requestText(`/v1/executions/${encodeURIComponent(id)}/logs`, {
        stream,
        inline: 'true',
      });
      return { text, truncated: headers.get('x-truncated') === 'true' };
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  },

  listApiKeys: () => request<{ items: ApiKey[] }>('GET', '/v1/api-keys'),
  createApiKey: (name: string) => request<CreatedApiKey>('POST', '/v1/api-keys', { body: { name } }),
  revokeApiKey: (id: string) => request<void>('DELETE', `/v1/api-keys/${encodeURIComponent(id)}`),

  adminWorkers: () => request<{ items: WorkerInfo[] }>('GET', '/v1/admin/workers'),
  adminQueue: () => request<QueueStats>('GET', '/v1/admin/queue'),
  adminDlq: () => request<{ items: Execution[] }>('GET', '/v1/admin/dlq'),
  adminRequeue: (id: string) => request<Execution>('POST', `/v1/admin/dlq/${encodeURIComponent(id)}/requeue`),
  adminTenants: () => request<{ items: AdminTenant[] }>('GET', '/v1/admin/tenants'),
  adminPatchTenant: (id: string, patch: TenantLimitsPatch) =>
    request<AdminTenant>('PATCH', `/v1/admin/tenants/${encodeURIComponent(id)}/limits`, { body: patch }),
};
