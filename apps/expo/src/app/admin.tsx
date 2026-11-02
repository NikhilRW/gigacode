import { useState } from 'react';
import { Text, View } from 'react-native';
import { AppScreen, Card, Field, FlowRow, ResourceState } from '@/components/AppScreen';
import { Button, Notice } from '@/components/ui';
import { useGet } from '@/lib/useResource';
import type { AdminTenant, Execution, Queue, TenantLimits, Worker } from '@/lib/types';
import { useAuth } from '@/state/AuthProvider';
import { useTheme } from '@/state/ThemeProvider';
import { describeError } from '@/lib/client';
const tabs = ['Workers', 'Queue', 'Dead letters', 'Tenants'] as const;
export default function Admin() {
  const [tab, setTab] = useState<typeof tabs[number]>('Workers');
  return <AppScreen title="Platform admin" subtitle="Live worker health, queue pressure, dead letters, and tenant limits. The API enforces administrator permissions on every request." admin>
    <FlowRow>{tabs.map(value => <Button key={value} label={value} variant={tab === value ? 'primary' : 'secondary'} onPress={() => setTab(value)} />)}</FlowRow>
    {tab === 'Workers' ? <Workers /> : tab === 'Queue' ? <QueuePanel /> : tab === 'Dead letters' ? <DeadLetters /> : <Tenants />}
  </AppScreen>;
}
function Workers() {
  const resource = useGet<{ items: Worker[] }>('/v1/admin/workers', {}, 5000); const { common } = useTheme();
  return <Card title="Workers"><ResourceState resource={resource} empty={resource.data?.items.length === 0} />{resource.data?.items.map(worker => <Card key={worker.id} title={`${worker.hostname} · ${worker.alive ? 'alive' : 'silent'}`}><Text selectable style={common.muted}>{worker.id} · {worker.version}</Text><Text style={common.text}>{worker.status} · {worker.busy ?? '?'} / {worker.slots} slots busy</Text><Text style={common.muted}>Last heartbeat: {new Date(worker.lastHeartbeatAt).toLocaleString()}</Text></Card>)}</Card>;
}
function QueuePanel() {
  const resource = useGet<Queue>('/v1/admin/queue', {}, 3000); const { common } = useTheme();
  return <Card title="Queue"><ResourceState resource={resource} />{resource.data && <><Text style={common.text}>Depth {resource.data.depth} · oldest {Math.round(resource.data.oldestAgeSeconds)} s</Text>{resource.data.byTenant.length === 0 && <Text style={common.muted}>Nothing queued or running.</Text>}{resource.data.byTenant.map(tenant => <Text key={tenant.tenantId} style={common.muted}>{tenant.tenantName} · {tenant.queued} queued · {tenant.running} running</Text>)}</>}</Card>;
}
function DeadLetters() {
  const resource = useGet<{ items: Execution[] }>('/v1/admin/dlq', {}, 5000);
  const { api, me } = useAuth(); const { common } = useTheme();
  const [confirm, setConfirm] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const requeue = async (id: string) => {
    setBusy(true); setMessage('');
    try { await api.request('POST', `/v1/admin/dlq/${encodeURIComponent(id)}/requeue`); setConfirm(null); setMessage('Execution requeued.'); resource.reload(); }
    catch (err) { setMessage(describeError(err)); } finally { setBusy(false); }
  };
  return <Card title="Dead-lettered runs"><ResourceState resource={resource} empty={resource.data?.items.length === 0} />{!!message && <Notice>{message}</Notice>}{resource.data?.items.map(run => <View key={run.id} style={{ gap: 10, paddingVertical: 10 }}><Text selectable style={common.muted}>{run.id} · {run.language} · {run.failureReason || run.status}</Text><Text selectable style={common.muted}>Workspace: {run.tenantId}</Text><FlowRow>{run.tenantId === me?.tenant.id && <Button label="Details" href={{ pathname: '/execution', params: { id: run.id } }} />}<Button label="Requeue" disabled={busy} onPress={() => setConfirm(run.id)} /></FlowRow>{confirm === run.id && <><Notice>This resubmits the dead-lettered execution to the worker queue.</Notice><FlowRow><Button label="Confirm requeue" disabled={busy} onPress={() => { void requeue(run.id); }} /><Button label="Keep in dead letters" disabled={busy} onPress={() => setConfirm(null)} /></FlowRow></>}</View>)}</Card>;
}
const fields: { key: keyof TenantLimits; label: string; min: number; max: number }[] = [
  { key: 'maxConcurrent', label: 'Concurrent slots', min: 1, max: 256 }, { key: 'maxExecPerMin', label: 'Executions / minute', min: 1, max: 100000 }, { key: 'maxTimeoutMs', label: 'Timeout ms', min: 100, max: 10000 }, { key: 'maxMemoryMb', label: 'Memory MiB', min: 16, max: 512 }, { key: 'maxSourceBytes', label: 'Source bytes', min: 1024, max: 16 * 1024 * 1024 },
];
function Tenants() {
  const resource = useGet<{ items: AdminTenant[] }>('/v1/admin/tenants');
  return <Card title="Tenants & limits"><ResourceState resource={resource} empty={resource.data?.items.length === 0} />{resource.data?.items.map(tenant => <TenantEditor key={`${tenant.id}:${fields.map(f => tenant[f.key]).join(',')}`} tenant={tenant} saved={resource.reload} />)}</Card>;
}
function TenantEditor({ tenant, saved }: { tenant: AdminTenant; saved: () => void }) {
  const { api } = useAuth(); const { common } = useTheme();
  const [draft, setDraft] = useState<Record<keyof TenantLimits, string>>({ maxConcurrent: String(tenant.maxConcurrent), maxExecPerMin: String(tenant.maxExecPerMin), maxTimeoutMs: String(tenant.maxTimeoutMs), maxMemoryMb: String(tenant.maxMemoryMb), maxSourceBytes: String(tenant.maxSourceBytes) });
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const dirty = fields.some(f => draft[f.key] !== String(tenant[f.key]));
  const save = async () => {
    setBusy(true); setMessage('');
    try {
      const patch: Partial<TenantLimits> = {};
      for (const field of fields) {
        const value = Number(draft[field.key]);
        if (!/^\d+$/.test(draft[field.key]) || !Number.isSafeInteger(value) || value < field.min || value > field.max) throw new Error(`${field.label} must be an integer from ${field.min} to ${field.max}.`);
        if (value !== tenant[field.key]) patch[field.key] = value;
      }
      await api.request('PATCH', `/v1/admin/tenants/${encodeURIComponent(tenant.id)}/limits`, { body: patch }); saved();
    } catch (err) { setMessage(describeError(err)); } finally { setBusy(false); }
  };
  return <Card title={tenant.name}><Text selectable style={common.muted}>{tenant.id}</Text><FlowRow>{fields.map(field => <View key={field.key} style={{ flexGrow: 1, flexBasis: 200 }}><Field label={`${field.label} (${field.min}–${field.max})`} value={draft[field.key]} onChangeText={value => setDraft(values => ({ ...values, [field.key]: value }))} keyboardType="number-pad" /></View>)}</FlowRow><Button label={busy ? 'Saving…' : 'Save tenant limits'} disabled={busy || !dirty} onPress={() => { void save(); }} variant="primary" />{!!message && <Notice>{message}</Notice>}</Card>;
}
