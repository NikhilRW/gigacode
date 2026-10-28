import type { ExecutionEvent } from '@engine/shared';
import { describeEvent } from '@/lib/runStatus';
import { StatusChip } from './StatusChip';
import { LogsPanel, MetricChips } from './RunOutput';

/** Readable run history: what happened and when, in plain words. */
export function Timeline({ events }: { events: ExecutionEvent[] }) {
  if (events.length === 0) return <p className="text-sm text-muted-foreground">No events yet.</p>;
  return (
    <ol className="space-y-3" aria-label="Run timeline" data-testid="timeline">
      {events.map((ev) => (
        <li key={ev.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="w-24 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
            {new Date(ev.at).toLocaleTimeString()}
          </span>
          <StatusChip status={ev.toStatus} />
          <span>{describeEvent(ev.toStatus, ev.fromStatus, ev.detail?.reason)}</span>
          {ev.attempt > 1 && <span className="text-xs text-muted-foreground">attempt {ev.attempt}</span>}
        </li>
      ))}
    </ol>
  );
}

// Names kept for the run-detail page until it is redesigned.
export const Metrics = MetricChips;
export const LogsViewer = LogsPanel;
