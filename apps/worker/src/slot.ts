import { join } from 'node:path';
import type { Logger } from 'pino';
import { s3Keys, sleep, withRetry, jitteredBackoffMs, type ResultFile, type StatusEvent } from '@engine/shared';
import type { ClaimedJob, JobQueue } from '@engine/db';
import type { SandboxDriver } from '@engine/sandbox';
import type { Storage } from '@engine/storage';
import type { WorkerConfig } from './config.ts';
import { executeInSandbox } from './execute.ts';
import type { AbortReason } from './result-mapping.ts';
import { cleanupRunDir, readSmall, prepareRunDir, type RunDir } from './run-dir.ts';
import type { Hints } from './hints.ts';

export interface SlotDeps {
  config: WorkerConfig;
  queue: JobQueue;
  storage: Storage;
  driver: SandboxDriver;
  hints: Hints;
  log: Logger;
}

/** One execution slot: claim → heartbeat → start → run → upload → fenced complete → cleanup. */
export class Slot {
  busy = false;
  private stopping = false;
  private current: AbortController | null = null;
  private currentAbort: AbortReason | null = null;

  constructor(
    readonly index: number,
    private readonly deps: SlotDeps,
  ) {}

  /** Each slot maps the sandbox user to its own host uid. */
  get hostUid() {
    return 200_000 + this.index;
  }

  stop() {
    this.stopping = true;
  }

  /** Kill the running sandbox; its job is left to lease expiry and requeue. */
  abortCurrent(reason: AbortReason) {
    this.currentAbort ??= reason;
    this.current?.abort();
  }

  async loop(): Promise<void> {
    const { config, queue, log, hints } = this.deps;
    let failures = 0;
    while (!this.stopping) {
      let job: ClaimedJob | null = null;
      try {
        job = await queue.claim(config.workerId, config.LEASE_SECONDS);
        failures = 0;
      } catch (err) {
        failures++;
        log.warn({ err: (err as Error).message, slot: this.index }, 'claim failed, backing off');
        await sleep(500 + jitteredBackoffMs(failures, 250, 10_000));
        continue;
      }
      if (!job) {
        await hints.waitForWork(config.POLL_INTERVAL_MS + Math.floor(Math.random() * config.POLL_INTERVAL_MS));
        continue;
      }
      this.busy = true;
      try {
        await this.process(job);
      } catch (err) {
        log.error({ err: (err as Error).message, executionId: job.id, attempt: job.attempt }, 'job processing error');
      } finally {
        this.busy = false;
      }
    }
  }

  private async process(job: ClaimedJob): Promise<void> {
    const { config, queue, storage, driver, hints } = this.deps;
    const log = this.deps.log.child({ executionId: job.id, attempt: job.attempt, tenantId: job.tenantId, slot: this.index });
    const controller = new AbortController();
    this.current = controller;
    this.currentAbort = null;
    let leaseLost = false;
    const abort = (reason: AbortReason) => {
      this.currentAbort ??= reason;
      controller.abort();
    };
    const publish = (status: StatusEvent['status']) =>
      hints.publishStatus(job.tenantId, { id: job.id, status, attempt: job.attempt, at: new Date().toISOString() });
    publish('DISPATCHED');

    const heartbeat = setInterval(async () => {
      if (config.chaosDropHeartbeats) return;
      try {
        const hb = await queue.heartbeat(job, config.workerId, config.LEASE_SECONDS);
        if (!hb.leaseHeld) {
          leaseLost = true;
          log.warn('lease lost, killing sandbox');
          abort('lease_lost');
        } else if (hb.cancelRequested) {
          abort('cancel');
        }
      } catch (err) {
        log.warn({ err: (err as Error).message }, 'heartbeat failed');
      }
    }, config.HEARTBEAT_SECONDS * 1000);

    let dir: RunDir | null = null;
    try {
      if (job.cancelRequested) {
        if (await queue.complete(job, config.workerId, cancelled())) publish('CANCELLED');
        return;
      }
      if (!(await queue.advance(job, config.workerId, 'DISPATCHED', 'STARTING'))) return;
      publish('STARTING');

      try {
        dir = await prepareRunDir(config.RUNS_DIR, job, storage, this.hostUid, 128);
      } catch (err) {
        // Source unavailable or corrupt after retries: infrastructure problem, not the user's.
        // Stop heartbeating and let the lease expire so the job is retried elsewhere.
        log.error({ err: (err as Error).message }, 'run dir preparation failed; leaving job for lease expiry');
        clearInterval(heartbeat);
        return;
      }

      if (!(await queue.advance(job, config.workerId, 'STARTING', 'RUNNING'))) return;
      publish('RUNNING');
      log.info({ files: dir.manifest.files.length, language: job.language }, 'sandbox run starting');

      const exec = await executeInSandbox({
        driver,
        job,
        dir,
        rootfsDir: config.SANDBOX_ROOTFS_DIR,
        hostUid: this.hostUid,
        signal: controller.signal,
        abortReason: () => this.currentAbort,
      });

      if (leaseLost || this.currentAbort === 'lease_lost' || this.currentAbort === 'shutdown') {
        log.warn({ reason: this.currentAbort }, 'discarding result');
        return;
      }

      const r = exec.result;
      const prefix = s3Keys.attemptPrefix(job.tenantId, job.id, job.attempt);
      const resultFile: ResultFile = {
        executionId: job.id,
        attempt: job.attempt,
        status: exec.outcome.status,
        exitCode: r.exitCode,
        termSignal: r.termSignal,
        failureReason: exec.outcome.failureReason,
        wallMs: r.wallMs,
        cpuMs: r.cpuMs,
        peakMemoryBytes: r.peakMemoryBytes,
        stdoutTruncated: r.stdoutTruncated,
        stderrTruncated: r.stderrTruncated,
        stdoutBytes: r.stdoutBytes,
        stderrBytes: r.stderrBytes,
        compile: exec.compile,
      };
      try {
        await withRetry(async () => {
          await storage.put(`${prefix}stdout.log`, await readSmall(join(dir!.root, 'stdout.log')), 'text/plain');
          await storage.put(`${prefix}stderr.log`, await readSmall(join(dir!.root, 'stderr.log')), 'text/plain');
          await storage.put(`${prefix}result.json`, JSON.stringify(resultFile), 'application/json');
        }, 6, 500);
      } catch (err) {
        log.error({ err: (err as Error).message }, 'result upload failed; leaving job for lease expiry');
        clearInterval(heartbeat);
        return;
      }

      const ok = await withRetry(
        () =>
          queue.complete(job, config.workerId, {
            status: exec.outcome.status,
            exitCode: r.exitCode,
            termSignal: r.termSignal,
            failureReason: exec.outcome.failureReason,
            wallMs: r.wallMs,
            cpuMs: r.cpuMs,
            peakMemoryBytes: r.peakMemoryBytes,
            stdoutTruncated: r.stdoutTruncated,
            stderrTruncated: r.stderrTruncated,
            resultPrefix: prefix,
          }),
        4,
        300,
      );
      if (!ok) {
        // Fenced: another attempt owns this execution now. Remove our objects.
        log.warn('completion fenced; deleting stale attempt objects');
        await storage.deletePrefix(prefix).catch(() => {});
        await hints.countFenced();
        return;
      }
      publish(exec.outcome.status);
      log.info(
        { status: exec.outcome.status, wallMs: r.wallMs, stdoutBytes: r.stdoutBytes, stderrBytes: r.stderrBytes },
        'execution finished',
      );
    } finally {
      clearInterval(heartbeat);
      this.current = null;
      await cleanupRunDir(dir, join(config.RUNS_DIR, `${job.id}-${job.attempt}`));
    }
  }
}

function cancelled() {
  return {
    status: 'CANCELLED' as const,
    exitCode: null,
    termSignal: null,
    failureReason: null,
    wallMs: 0,
    cpuMs: 0,
    peakMemoryBytes: 0,
    stdoutTruncated: false,
    stderrTruncated: false,
    resultPrefix: null,
  };
}

