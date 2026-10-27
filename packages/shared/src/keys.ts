/** All S3 keys are built here, server side. Clients never choose keys. */
export const s3Keys = {
  executionPrefix: (tenantId: string, executionId: string) => `tenants/${tenantId}/executions/${executionId}/`,
  sourcePrefix: (tenantId: string, executionId: string) => `tenants/${tenantId}/executions/${executionId}/source/`,
  sourceFile: (tenantId: string, executionId: string, path: string) =>
    `tenants/${tenantId}/executions/${executionId}/source/files/${path}`,
  manifest: (tenantId: string, executionId: string) =>
    `tenants/${tenantId}/executions/${executionId}/source/manifest.json`,
  stdin: (tenantId: string, executionId: string) => `tenants/${tenantId}/executions/${executionId}/source/stdin`,
  attemptPrefix: (tenantId: string, executionId: string, attempt: number) =>
    `tenants/${tenantId}/executions/${executionId}/attempts/${attempt}/`,
};

/** Written last by the API; its presence means the source upload completed. */
export interface SourceManifest {
  files: { path: string; bytes: number; sha256: string }[];
  stdin: { bytes: number; sha256: string };
}

export const redisKeys = {
  execChannel: (id: string) => `exec:${id}`,
  execCache: (tenantId: string, id: string) => `exec:${tenantId}:${id}`,
  apiKeyCache: (prefix: string) => `apikey:${prefix}`,
  rateLimit: (tenantId: string) => `rl:${tenantId}`,
  worker: (id: string) => `worker:${id}`,
  workerPattern: 'worker:*',
  queueWake: 'queue:wake',
  fencedCounter: 'metrics:fenced_results_discarded_total',
};
