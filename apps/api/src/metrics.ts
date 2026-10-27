import { Counter, Gauge, Histogram, Registry } from 'prom-client';

export type Metrics = ReturnType<typeof createMetrics>;

/** One registry per app instance (tests build several apps in one process). */
export function createMetrics() {
  const registry = new Registry();
  const r = [registry];
  return {
    registry,
    httpRequests: new Counter({
      name: 'http_requests_total',
      help: 'HTTP requests',
      labelNames: ['method', 'route', 'status'],
      registers: r,
    }),
    httpDuration: new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration',
      labelNames: ['method', 'route'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: r,
    }),
    executionsCreated: new Counter({ name: 'executions_created_total', help: 'Executions created', registers: r }),
    executionsFinished: new Counter({
      name: 'executions_finished_total',
      help: 'Executions reaching a terminal state',
      labelNames: ['status'],
      registers: r,
    }),
    queueDepth: new Gauge({ name: 'queue_depth', help: 'QUEUED executions', registers: r }),
    oldestQueuedAge: new Gauge({
      name: 'oldest_queued_age_seconds',
      help: 'Age of the oldest QUEUED execution',
      registers: r,
    }),
    slotsBusy: new Gauge({ name: 'sandbox_slots_busy', help: 'Busy sandbox slots across live workers', registers: r }),
    slotsTotal: new Gauge({ name: 'sandbox_slots_total', help: 'Sandbox slots across live workers', registers: r }),
    leaseExpirations: new Counter({ name: 'lease_expirations_total', help: 'Expired leases reaped', registers: r }),
    deadLettered: new Counter({ name: 'dead_lettered_total', help: 'Executions dead-lettered', registers: r }),
    fencedDiscarded: new Gauge({
      name: 'fenced_results_discarded_total',
      help: 'Worker results rejected by attempt fencing (reported by workers via Redis)',
      registers: r,
    }),
    rateLimited: new Counter({ name: 'rate_limited_total', help: 'Requests rejected by rate limiting', registers: r }),
    s3Errors: new Counter({ name: 's3_errors_total', help: 'S3 errors', labelNames: ['op'], registers: r }),
    dbErrors: new Counter({ name: 'db_errors_total', help: 'Database errors', registers: r }),
    redisErrors: new Counter({ name: 'redis_errors_total', help: 'Redis errors', registers: r }),
  };
}
