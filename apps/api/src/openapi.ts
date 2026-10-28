import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodTypeAny } from 'zod';
import {
  adminTenantSchema,
  apiKeySchema,
  createApiKeySchema,
  createExecutionSchema,
  createdApiKeySchema,
  errorBodySchema,
  executionDetailSchema,
  executionListSchema,
  executionSchema,
  logLinkSchema,
  loginSchema,
  meSchema,
  queueStatsSchema,
  registerSchema,
  resultFileSchema,
  tenantLimitsPatchSchema,
  usageSchema,
  onboardingSchema,
  timeseriesSchema,
  updateProfileSchema,
  changePasswordSchema,
  workerInfoSchema,
} from '@engine/shared';

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const schema = (s: ZodTypeAny) => zodToJsonSchema(s, { target: 'openApi3', $refStrategy: 'none' });

const components: Record<string, ZodTypeAny> = {
  CreateExecution: createExecutionSchema,
  Execution: executionSchema,
  ExecutionDetail: executionDetailSchema,
  ExecutionList: executionListSchema,
  Result: resultFileSchema,
  LogLink: logLinkSchema,
  Register: registerSchema,
  Login: loginSchema,
  Me: meSchema,
  CreateApiKey: createApiKeySchema,
  ApiKey: apiKeySchema,
  CreatedApiKey: createdApiKeySchema,
  Usage: usageSchema,
  Onboarding: onboardingSchema,
  Timeseries: timeseriesSchema,
  UpdateProfile: updateProfileSchema,
  ChangePassword: changePasswordSchema,
  WorkerInfo: workerInfoSchema,
  QueueStats: queueStatsSchema,
  AdminTenant: adminTenantSchema,
  TenantLimitsPatch: tenantLimitsPatchSchema,
  Error: errorBodySchema,
};

type Op = { summary: string; body?: string; response?: string; status?: number };
const json = (name: string) => ({ content: { 'application/json': { schema: ref(name) } } });

function op(o: Op) {
  return {
    summary: o.summary,
    ...(o.body ? { requestBody: { required: true, ...json(o.body) } } : {}),
    responses: {
      [String(o.status ?? 200)]: { description: 'OK', ...(o.response ? json(o.response) : {}) },
      default: { description: 'Error', ...json('Error') },
    },
  };
}

export function buildOpenApi() {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Code Execution Engine API',
      version: '1.0.0',
      description:
        'Multi-tenant code execution with layered isolation and resource containment. Authenticate with `Authorization: Bearer ce_live_...` or a dashboard session cookie.',
    },
    components: {
      securitySchemes: { apiKey: { type: 'http', scheme: 'bearer' }, session: { type: 'apiKey', in: 'cookie', name: 'session' } },
      schemas: Object.fromEntries(Object.entries(components).map(([k, v]) => [k, schema(v)])),
    },
    security: [{ apiKey: [] }, { session: [] }],
    paths: {
      '/v1/auth/register': { post: op({ summary: 'Create tenant and owner', body: 'Register', response: 'Me', status: 201 }) },
      '/v1/auth/login': { post: op({ summary: 'Log in', body: 'Login', response: 'Me' }) },
      '/v1/auth/logout': { post: op({ summary: 'Log out', status: 204 }) },
      '/v1/me': {
        get: op({ summary: 'Current user and tenant', response: 'Me' }),
        patch: op({ summary: 'Update profile name (session only)', body: 'UpdateProfile', response: 'Me' }),
      },
      '/v1/me/password': { post: op({ summary: 'Change password (session only)', body: 'ChangePassword', status: 204 }) },
      '/v1/api-keys': {
        get: op({ summary: 'List API keys' }),
        post: op({ summary: 'Create API key (returned once)', body: 'CreateApiKey', response: 'CreatedApiKey', status: 201 }),
      },
      '/v1/api-keys/{id}': { delete: op({ summary: 'Revoke API key', status: 204 }) },
      '/v1/executions': {
        get: op({ summary: 'List executions (cursor paginated)', response: 'ExecutionList' }),
        post: op({ summary: 'Submit code (optional Idempotency-Key header)', body: 'CreateExecution', status: 202 }),
      },
      '/v1/executions/{id}': { get: op({ summary: 'Execution metadata, events, attempts', response: 'ExecutionDetail' }) },
      '/v1/executions/{id}/source': { get: op({ summary: 'Submitted files and stdin' }) },
      '/v1/executions/{id}/logs': { get: op({ summary: 'Presigned log URL, or ?inline=true text', response: 'LogLink' }) },
      '/v1/executions/{id}/result': { get: op({ summary: 'Parsed result.json', response: 'Result' }) },
      '/v1/executions/{id}/events': { get: op({ summary: 'Server-Sent Events status stream (session cookie only)' }) },
      '/v1/executions/{id}/cancel': { post: op({ summary: 'Cancel execution', response: 'Execution' }) },
      '/v1/usage': { get: op({ summary: 'Tenant usage and limits', response: 'Usage' }) },
      '/v1/usage/timeseries': { get: op({ summary: 'Runs per hour by outcome (?hours=1..168)', response: 'Timeseries' }) },
      '/v1/onboarding': { get: op({ summary: 'Setup checklist state', response: 'Onboarding' }) },
      '/v1/admin/workers': { get: op({ summary: 'Workers (platform_admin)' }) },
      '/v1/admin/queue': { get: op({ summary: 'Queue stats (platform_admin)', response: 'QueueStats' }) },
      '/v1/admin/dlq': { get: op({ summary: 'Dead-lettered executions (platform_admin)' }) },
      '/v1/admin/dlq/{id}/requeue': { post: op({ summary: 'Requeue dead-lettered execution', response: 'Execution' }) },
      '/v1/admin/tenants': { get: op({ summary: 'Tenants (platform_admin)' }) },
      '/v1/admin/tenants/{id}/limits': {
        patch: op({ summary: 'Update tenant limits', body: 'TenantLimitsPatch', response: 'AdminTenant' }),
      },
      '/healthz': { get: op({ summary: 'Liveness' }) },
      '/readyz': { get: op({ summary: 'Readiness: Postgres, Redis, S3' }) },
    },
  };
}
