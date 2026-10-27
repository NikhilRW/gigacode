import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { isTerminal } from '@shared/states.ts';
import { LANGUAGES } from '@shared/languages.ts';
import { api } from '../api/endpoints.ts';
import { LogsViewer, Metrics, Timeline } from '../components/ExecutionResult.tsx';
import { StatusChip } from '../components/StatusChip.tsx';
import { Button, Card, ErrorNotice, Table, td } from '../components/ui.tsx';
import { formatBytes, formatMs, formatTime } from '../lib/format.ts';
import { useLiveExecution } from '../lib/useLiveExecution.ts';

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-1.5 text-sm last:border-0 dark:border-slate-800">
      <dt className="text-slate-500">{k}</dt>
      <dd className="text-right font-mono text-xs">{v}</dd>
    </div>
  );
}

export function ExecutionDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const live = useLiveExecution(id);
  const e = live.data;

  const cancel = useMutation({
    mutationFn: () => api.cancelExecution(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['execution', id] }),
  });
  const rerun = useMutation({
    mutationFn: async () => {
      const src = await api.getSource(id);
      return api.createExecution({
        language: src.language,
        files: src.files,
        entryFile: src.entryFile,
        stdin: src.stdin,
        limits: { timeoutMs: src.limits.timeoutMs, memoryMb: src.limits.memoryMb },
      });
    },
    onSuccess: (r) => navigate(`/executions/${r.id}`),
  });

  if (live.isPending) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!e) return <ErrorNotice error={live.error ?? new Error('Execution not found')} />;
  const active = !isTerminal(e.status);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Execution</h1>
        <StatusChip status={e.status} />
        <span className="font-mono text-xs text-slate-500">{e.id}</span>
        <div className="ml-auto flex gap-2">
          {active && (
            <Button variant="danger" onClick={() => cancel.mutate()} disabled={cancel.isPending || e.cancelRequested}>
              {e.cancelRequested ? 'Cancelling…' : 'Cancel'}
            </Button>
          )}
          <Button variant="secondary" onClick={() => rerun.mutate()} disabled={rerun.isPending}>
            {rerun.isPending ? 'Starting…' : 'Re-run'}
          </Button>
        </div>
      </div>
      <ErrorNotice error={cancel.error ?? rerun.error} />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Metadata">
          <dl>
            <Row k="Language" v={LANGUAGES[e.language]?.label ?? e.language} />
            <Row k="Entry file" v={e.entryFile} />
            <Row k="Attempt" v={`${e.attempt} / ${e.maxAttempts}`} />
            <Row k="Timeout" v={formatMs(e.limits.timeoutMs)} />
            <Row k="Memory limit" v={`${e.limits.memoryMb} MB`} />
            <Row k="Created" v={formatTime(e.createdAt)} />
            <Row k="Started" v={formatTime(e.startedAt)} />
            <Row k="Finished" v={formatTime(e.finishedAt)} />
            <Row k="Files" v={e.files.map((f) => `${f.path} (${formatBytes(f.bytes)})`).join(', ') || '—'} />
          </dl>
        </Card>
        <Card title="Result">
          <Metrics e={e} />
        </Card>
        <Card title="Timeline">
          <Timeline events={e.events} />
        </Card>
      </div>

      <Card title="Attempts">
        {e.attempts.length === 0 ? (
          <p className="text-sm text-slate-500">Not dispatched yet.</p>
        ) : (
          <Table head={['#', 'Worker', 'Started', 'Finished', 'Outcome', 'Exit']}>
            {e.attempts.map((a) => (
              <tr key={a.attempt}>
                <td className={td}>{a.attempt}</td>
                <td className={`${td} font-mono text-xs`}>{a.workerId}</td>
                <td className={td}>{formatTime(a.startedAt)}</td>
                <td className={td}>{formatTime(a.finishedAt)}</td>
                <td className={td}>{a.outcome ?? '—'}</td>
                <td className={td}>{a.exitCode ?? '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Logs">
        <LogsViewer e={e} />
      </Card>
    </div>
  );
}
