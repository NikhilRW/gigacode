import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ExecutionDetail, ExecutionEvent } from '@engine/shared';
import { isTerminal } from '@shared/states.ts';
import { api } from '../api/endpoints.ts';
import { formatBytes, formatMs } from '../lib/format.ts';
import { StatusChip } from './StatusChip.tsx';
import { ErrorNotice } from './ui.tsx';

export function Timeline({ events }: { events: ExecutionEvent[] }) {
  if (events.length === 0) return <p className="text-sm text-slate-500">No events yet.</p>;
  return (
    <ol className="space-y-2" aria-label="State timeline" data-testid="timeline">
      {events.map((ev) => (
        <li key={ev.id} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="w-24 shrink-0 tabular-nums text-xs text-slate-500">{new Date(ev.at).toLocaleTimeString()}</span>
          <StatusChip status={ev.toStatus} />
          {ev.attempt > 0 && <span className="text-xs text-slate-500">attempt {ev.attempt}</span>}
          {typeof ev.detail?.failureReason === 'string' && (
            <span className="text-xs text-slate-500">{ev.detail.failureReason}</span>
          )}
        </li>
      ))}
    </ol>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="font-mono text-sm tabular-nums">{value}</dd>
    </div>
  );
}

export function Metrics({ e }: { e: ExecutionDetail }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Metric label="Exit code" value={e.exitCode === null ? '—' : String(e.exitCode)} />
      <Metric label="Wall time" value={formatMs(e.wallMs)} />
      <Metric label="CPU time" value={formatMs(e.cpuMs)} />
      <Metric label="Peak memory" value={formatBytes(e.peakMemoryBytes)} />
      {e.termSignal && <Metric label="Signal" value={e.termSignal} />}
      {e.failureReason && <Metric label="Failure reason" value={e.failureReason} />}
    </dl>
  );
}

/** Logs are always rendered as text inside <pre>, never as HTML. */
export function LogsViewer({ e }: { e: ExecutionDetail }) {
  const [stream, setStream] = useState<'stdout' | 'stderr'>('stdout');
  const done = isTerminal(e.status);
  const logs = useQuery({
    queryKey: ['logs', e.id, e.attempt, stream],
    queryFn: () => api.getLogs(e.id, stream),
    enabled: done,
    staleTime: Infinity,
  });
  const truncatedFlag = stream === 'stdout' ? e.stdoutTruncated : e.stderrTruncated;

  return (
    <div>
      <div role="tablist" aria-label="Log stream" className="mb-2 flex gap-1">
        {(['stdout', 'stderr'] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={stream === s}
            onClick={() => setStream(s)}
            className={`rounded-md px-3 py-1 text-sm font-mono ${
              stream === s
                ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            {s}
          </button>
        ))}
      </div>
      {!done && <p className="text-sm text-slate-500">Logs are available when the execution finishes.</p>}
      {logs.isError && <ErrorNotice error={logs.error} />}
      {done && logs.isPending && <p className="text-sm text-slate-500">Loading logs…</p>}
      {done && logs.data === null && <p className="text-sm text-slate-500">No {stream} was produced.</p>}
      {logs.data && (
        <>
          {(logs.data.truncated || truncatedFlag) && (
            <p className="mb-2 text-xs text-amber-700 dark:text-amber-300">
              Output was truncated at the per-stream cap.
            </p>
          )}
          <pre
            data-testid={`${stream}-panel`}
            className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-slate-950 p-3 font-mono text-xs text-slate-100"
          >
            {logs.data.text || `(empty ${stream})`}
          </pre>
        </>
      )}
    </div>
  );
}

export function ExecutionSummary({ e }: { e: ExecutionDetail }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <StatusChip status={e.status} />
        <span className="font-mono text-xs text-slate-500">{e.id}</span>
        {e.cancelRequested && !isTerminal(e.status) && <span className="text-xs text-slate-500">cancel requested…</span>}
      </div>
      <Metrics e={e} />
      <div>
        <h3 className="mb-2 text-sm font-semibold">Timeline</h3>
        <Timeline events={e.events} />
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold">Output</h3>
        <LogsViewer e={e} />
      </div>
    </div>
  );
}
