import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminTenant, TenantLimits, TenantLimitsPatch } from '@engine/shared';
import { api } from '../api/endpoints.ts';
import { ExecutionsTable } from '../components/ExecutionsTable.tsx';
import { Button, Card, ErrorNotice, Input, Stat, Table, td } from '../components/ui.tsx';
import { formatTime } from '../lib/format.ts';

const TABS = ['Workers', 'Queue', 'Dead letters', 'Tenants'] as const;
type Tab = (typeof TABS)[number];

function Workers() {
  const q = useQuery({ queryKey: ['admin', 'workers'], queryFn: api.adminWorkers, refetchInterval: 5000 });
  return (
    <Card title="Workers">
      <ErrorNotice error={q.error} />
      {q.data && q.data.items.length === 0 && <p className="text-sm text-slate-500">No workers have registered.</p>}
      {q.data && q.data.items.length > 0 && (
        <Table head={['ID', 'Host', 'Version', 'Slots busy', 'Status', 'Alive', 'Last heartbeat']}>
          {q.data.items.map((w) => (
            <tr key={w.id}>
              <td className={`${td} font-mono text-xs`}>{w.id}</td>
              <td className={td}>{w.hostname}</td>
              <td className={td}>{w.version}</td>
              <td className={`${td} tabular-nums`}>{w.busy ?? '?'} / {w.slots}</td>
              <td className={td}>{w.status}</td>
              <td className={td}>
                <span className={w.alive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                  {w.alive ? '● alive' : '○ silent'}
                </span>
              </td>
              <td className={td}>{formatTime(w.lastHeartbeatAt)}</td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

function Queue() {
  const q = useQuery({ queryKey: ['admin', 'queue'], queryFn: api.adminQueue, refetchInterval: 3000 });
  return (
    <div className="space-y-4">
      <ErrorNotice error={q.error} />
      <div className="grid grid-cols-2 gap-4">
        <Stat label="Queue depth" value={q.data?.depth ?? '—'} />
        <Stat label="Oldest queued" value={q.data ? `${Math.round(q.data.oldestAgeSeconds)} s` : '—'} />
      </div>
      <Card title="By tenant">
        {q.data && q.data.byTenant.length === 0 && <p className="text-sm text-slate-500">Nothing queued or running.</p>}
        {q.data && q.data.byTenant.length > 0 && (
          <Table head={['Tenant', 'Queued', 'Running']}>
            {q.data.byTenant.map((t) => (
              <tr key={t.tenantId}>
                <td className={td}>{t.tenantName}</td>
                <td className={`${td} tabular-nums`}>{t.queued}</td>
                <td className={`${td} tabular-nums`}>{t.running}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

function DeadLetters() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'dlq'], queryFn: api.adminDlq });
  const requeue = useMutation({
    mutationFn: api.adminRequeue,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'dlq'] }),
  });
  return (
    <Card title="Dead-lettered executions">
      <ErrorNotice error={q.error ?? requeue.error} />
      {q.data && q.data.items.length === 0 && <p className="text-sm text-slate-500">The dead-letter queue is empty.</p>}
      {q.data && q.data.items.length > 0 && (
        <div className="space-y-3">
          <ExecutionsTable items={q.data.items} />
          <div className="flex flex-wrap gap-2">
            {q.data.items.map((e) => (
              <Button key={e.id} variant="secondary" onClick={() => requeue.mutate(e.id)} disabled={requeue.isPending}>
                Requeue {e.id.slice(0, 8)}
              </Button>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

const LIMIT_FIELDS: { key: keyof TenantLimits; label: string }[] = [
  { key: 'maxConcurrent', label: 'Concurrent' },
  { key: 'maxExecPerMin', label: 'Exec/min' },
  { key: 'maxTimeoutMs', label: 'Timeout ms' },
  { key: 'maxMemoryMb', label: 'Memory MB' },
  { key: 'maxSourceBytes', label: 'Source bytes' },
];

function TenantRow({ t }: { t: AdminTenant }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<TenantLimits>(t);
  const save = useMutation({
    mutationFn: () => {
      const patch: TenantLimitsPatch = {};
      for (const { key } of LIMIT_FIELDS) if (draft[key] !== t[key]) patch[key] = draft[key];
      return api.adminPatchTenant(t.id, patch);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'tenants'] }),
  });
  const dirty = LIMIT_FIELDS.some(({ key }) => draft[key] !== t[key]);
  return (
    <tr>
      <td className={td}>
        <div>{t.name}</div>
        <div className="font-mono text-xs text-slate-500">{t.id.slice(0, 8)}</div>
        {save.error && <ErrorNotice error={save.error} />}
      </td>
      {LIMIT_FIELDS.map(({ key, label }) => (
        <td key={key} className={td}>
          <Input
            type="number"
            aria-label={`${label} for ${t.name}`}
            className="!w-28"
            value={draft[key]}
            onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })}
          />
        </td>
      ))}
      <td className={td}>
        <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>Save</Button>
      </td>
    </tr>
  );
}

function Tenants() {
  const q = useQuery({ queryKey: ['admin', 'tenants'], queryFn: api.adminTenants });
  return (
    <Card title="Tenants and limits">
      <ErrorNotice error={q.error} />
      {q.data && (
        <Table head={['Tenant', ...LIMIT_FIELDS.map((f) => f.label), '']}>
          {q.data.items.map((t) => (
            // Key on values so the draft resets after a successful save.
            <TenantRow key={`${t.id}:${LIMIT_FIELDS.map((f) => t[f.key]).join(',')}`} t={t} />
          ))}
        </Table>
      )}
    </Card>
  );
}

export function AdminPage() {
  const [tab, setTab] = useState<Tab>('Workers');
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Platform admin</h1>
      <div role="tablist" aria-label="Admin sections" className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              tab === t ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 'Workers' && <Workers />}
      {tab === 'Queue' && <Queue />}
      {tab === 'Dead letters' && <DeadLetters />}
      {tab === 'Tenants' && <Tenants />}
    </div>
  );
}
