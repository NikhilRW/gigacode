import type { Redis } from 'ioredis';
import { isTerminal, redisKeys, type StatusEvent } from '@engine/shared';
import type { CommitHook } from '@engine/db';
import type { SafeRedis } from './redis.ts';
import type { Metrics } from './metrics.ts';

type Listener = (event: StatusEvent) => void;

/**
 * Publishes status changes after commit and fans out Redis pub/sub messages to SSE
 * listeners over one shared subscriber connection.
 */
export class EventBus {
  private subscriber: Redis | null = null;
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(
    private readonly redis: SafeRedis,
    private readonly metrics: Metrics,
  ) {}

  /** afterCommit hook for transitionExecution: publish, invalidate cache, count terminal states. */
  readonly afterCommit: CommitHook = async (event) => {
    if (isTerminal(event.status)) this.metrics.executionsFinished.inc({ status: event.status });
    await this.invalidate(event.tenantId, event.id);
    const payload: StatusEvent = { id: event.id, status: event.status, attempt: event.attempt, at: event.at };
    await this.redis.safe((r) => r.publish(redisKeys.execChannel(event.id), JSON.stringify(payload)), 0);
  };

  async invalidate(tenantId: string, id: string): Promise<void> {
    await this.redis.safe((r) => r.del(redisKeys.execCache(tenantId, id)), 0);
  }

  async wakeWorkers(): Promise<void> {
    await this.redis.safe((r) => r.publish(redisKeys.queueWake, '1'), 0);
  }

  private ensureSubscriber(): Redis | null {
    if (this.subscriber) return this.subscriber;
    try {
      const sub = this.redis.client.duplicate({ enableOfflineQueue: true });
      sub.on('error', () => {});
      sub.on('message', (channel: string, message: string) => {
        const set = this.listeners.get(channel);
        if (!set) return;
        let event: StatusEvent;
        try {
          event = JSON.parse(message) as StatusEvent;
        } catch {
          return;
        }
        for (const l of set) l(event);
      });
      // Re-subscribe after reconnects.
      sub.on('ready', () => {
        const channels = [...this.listeners.keys()];
        if (channels.length > 0) sub.subscribe(...channels).catch(() => {});
      });
      this.subscriber = sub;
      return sub;
    } catch {
      return null;
    }
  }

  /** Returns an unsubscribe function. Never throws; SSE falls back to polling. */
  subscribe(executionId: string, listener: Listener): () => void {
    const channel = redisKeys.execChannel(executionId);
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
      const sub = this.ensureSubscriber();
      if (sub?.status === 'ready') sub.subscribe(channel).catch(() => {});
    }
    set.add(listener);
    return () => {
      const s = this.listeners.get(channel);
      if (!s) return;
      s.delete(listener);
      if (s.size === 0) {
        this.listeners.delete(channel);
        if (this.subscriber?.status === 'ready') this.subscriber.unsubscribe(channel).catch(() => {});
      }
    };
  }

  async close(): Promise<void> {
    this.listeners.clear();
    if (this.subscriber) this.subscriber.disconnect();
    this.subscriber = null;
  }
}
