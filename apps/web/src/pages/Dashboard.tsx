import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/endpoints.ts';
import { ExecutionsTable } from '../components/ExecutionsTable.tsx';
import { Card, ErrorNotice, Stat } from '../components/ui.tsx';
import { formatBytes, formatMs, formatPercent } from '../lib/format.ts';

function UsageBar({ label, used, max, unit }: { label: string; used: number; max: number; unit?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-slate-500">
          {used} / {max} {unit}
        </span>
      </div>
      <div className="h-2 rounded bg-slate-200 dark:bg-slate-800" role="progressbar" aria-label={label} aria-valuenow={used} aria-valuemin={0} aria-valuemax={max}>
        <div className="h-2 rounded bg-indigo-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function DashboardPage() {
  const usage = useQuery({ queryKey: ['usage'], queryFn: api.usage, refetchInterval: 5000 });
  const recent = useQuery({ queryKey: ['executions', 'recent'], queryFn: () => api.listExecutions({ limit: 10 }), refetchInterval: 5000 });
  const u = usage.data;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <Link to="/new" className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">
          New execution
        </Link>
      </div>
      <ErrorNotice error={usage.error} />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Running" value={u?.running ?? '—'} />
        <Stat label="Queued" value={u?.queued ?? '—'} />
        <Stat label="Success rate (24h)" value={formatPercent(u?.successRate24h)} />
        <Stat label="Executions today" value={u?.executionsToday ?? '—'} sub={u ? `CPU total ${formatMs(u.totalCpuMs)}` : undefined} />
      </div>
      {u && (
        <Card title="Usage vs limits">
          <div className="grid gap-4 md:grid-cols-2">
            <UsageBar label="Concurrent executions" used={u.running} max={u.limits.maxConcurrent} />
            <UsageBar label="Executions today vs per-minute rate" used={u.executionsToday} max={u.limits.maxExecPerMin} unit="/ min cap" />
            <p className="text-sm text-slate-500">Max timeout: {formatMs(u.limits.maxTimeoutMs)}</p>
            <p className="text-sm text-slate-500">
              Max memory: {u.limits.maxMemoryMb} MB · Max source: {formatBytes(u.limits.maxSourceBytes)}
            </p>
          </div>
        </Card>
      )}
      <Card title="Recent executions" actions={<Link className="text-sm text-indigo-600 underline dark:text-indigo-400" to="/executions">View all</Link>}>
        <ErrorNotice error={recent.error} />
        {recent.data && <ExecutionsTable items={recent.data.items} />}
      </Card>
    </div>
  );
}
