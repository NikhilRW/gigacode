import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Info, XCircle } from 'lucide-react';
import type { ExecutionDetail } from '@engine/shared';
import { isTerminal } from '@shared/states.ts';
import { api } from '@/api/endpoints';
import { CopyButton } from '@/components/CopyButton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatBytes, formatMs } from '@/lib/format';
import { explainOutcome } from '@/lib/runStatus';
import { cn } from '@/lib/utils';

function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-card px-3 py-2">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-mono text-sm tabular-nums">{value}</dd>
    </div>
  );
}

export function MetricChips({ e }: { e: ExecutionDetail }) {
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5" data-testid="metrics">
      <MetricChip label="Exit code" value={e.exitCode === null ? '—' : String(e.exitCode)} />
      <MetricChip label="Wall time" value={formatMs(e.wallMs)} />
      <MetricChip label="CPU time" value={formatMs(e.cpuMs)} />
      <MetricChip label="Peak memory" value={formatBytes(e.peakMemoryBytes)} />
      <MetricChip label="Internet" value={e.network === undefined ? 'Unknown' : e.network ? 'On' : 'Off'} />
    </dl>
  );
}

export function OutcomeNotice({ e }: { e: ExecutionDetail }) {
  const x = explainOutcome(e);
  if (!x) return null;
  const Icon = x.tone === 'warning' ? AlertTriangle : x.tone === 'danger' ? XCircle : Info;
  return (
    <Alert variant={x.tone === 'warning' ? 'warning' : x.tone === 'danger' ? 'destructive' : 'default'} data-testid="outcome-notice">
      <Icon aria-hidden />
      <div>
        <AlertTitle>{x.title}</AlertTitle>
        <AlertDescription>
          <p>{x.detail}</p>
          {x.action && <p className="mt-1 font-medium text-foreground">{x.action}</p>}
        </AlertDescription>
      </div>
    </Alert>
  );
}

/** Logs are always rendered as text inside <pre>, never as HTML. */
export function LogsPanel({ e, className }: { e: ExecutionDetail; className?: string }) {
  const done = isTerminal(e.status);
  const stdout = useQuery({ queryKey: ['logs', e.id, e.attempt, 'stdout'], queryFn: () => api.getLogs(e.id, 'stdout'), enabled: done, staleTime: Infinity });
  const stderr = useQuery({ queryKey: ['logs', e.id, e.attempt, 'stderr'], queryFn: () => api.getLogs(e.id, 'stderr'), enabled: done, staleTime: Infinity });
  const [stream, setStream] = useState<'stdout' | 'stderr'>('stdout');

  // When a run fails with nothing on stdout, open the stream that explains why.
  const failed = e.status !== 'SUCCESS';
  const hasErr = !!stderr.data?.text;
  const hasOut = !!stdout.data?.text;
  useEffect(() => {
    if (done && failed && hasErr && !hasOut) setStream('stderr');
  }, [e.id, done, failed, hasErr, hasOut]);

  const current = stream === 'stdout' ? stdout : stderr;
  const truncated = (stream === 'stdout' ? e.stdoutTruncated : e.stderrTruncated) || !!current.data?.truncated;

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <Tabs value={stream} onValueChange={(v) => setStream(v as 'stdout' | 'stderr')}>
          <TabsList className="h-8">
            <TabsTrigger value="stdout" className="font-mono text-xs">
              stdout{hasOut ? '' : ''}
            </TabsTrigger>
            <TabsTrigger value="stderr" className="font-mono text-xs">
              stderr{hasErr && failed ? ' •' : ''}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {current.data?.text ? <CopyButton text={current.data.text} /> : null}
      </div>
      {!done && <p className="text-sm text-muted-foreground">Output appears when the run finishes.</p>}
      {done && current.isError && (
        <p role="alert" className="text-sm text-destructive">
          Could not load the output. Try again in a moment.
        </p>
      )}
      {done && current.isPending && <Skeleton className="h-24 w-full" />}
      {done && current.data === null && <p className="text-sm text-muted-foreground">No {stream} was produced.</p>}
      {current.data && (
        <>
          {truncated && (
            <p className="mb-2 text-xs text-warning">Output was cut at the 1 MB per-stream limit. The end is not shown.</p>
          )}
          <pre
            data-testid={`${stream}-panel`}
            tabIndex={0}
            aria-label={`${stream} output`}
            className="min-h-24 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/50 p-3 font-mono text-xs leading-relaxed"
          >
            {current.data.text || `(empty ${stream})`}
          </pre>
        </>
      )}
    </div>
  );
}
