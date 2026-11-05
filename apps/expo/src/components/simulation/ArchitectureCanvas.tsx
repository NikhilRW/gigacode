import { ScrollView, Text, View } from 'react-native';
import { Card, FlowRow } from '@/components/AppScreen';
import { Button, Notice } from '@/components/ui';
import { tenantTelemetry, type ActivitySnapshot } from '@/lib/simulation/observer';
import type { SimulationSnapshot } from '@/lib/simulation/controller';
import { terminal } from '@/lib/types';
import { useTheme } from '@/state/ThemeProvider';
import { font, mono } from '@/theme';

export function ArchitectureCanvas({ activity, experiment, tenantName }: {
  activity: ActivitySnapshot; experiment: SimulationSnapshot; tenantName: string;
}) {
  const { colors, common } = useTheme();
  const telemetry = tenantTelemetry(activity, experiment);
  const { usage, fresh, at } = telemetry;
  const age = at === null ? null : Math.max(0, Math.floor((activity.now - at) / 1000));
  const recent = fresh && at !== null && activity.now - at < 1200;
  const listFresh = activity.executionsAt !== null && activity.now - activity.executionsAt <= 25_000 &&
    !activity.error && activity.mode !== 'paused' && !telemetry.cooldown;
  const results = activity.executions?.filter((row) => terminal(row.status));
  const statuses = results?.reduce<Record<string, number>>((counts, row) => ({ ...counts, [row.status]: (counts[row.status] ?? 0) + 1 }), {});
  const count = (n: number | undefined, label: string) => n === undefined || !Number.isFinite(n) ? 'Not observed' : `${n} ${label}${fresh ? '' : ' · last known'}`;
  const nodes = [
    { title: 'Clients', scope: 'STATIC ARCHITECTURE', value: 'Web · mobile · API', detail: 'Submit source + limits; read results via API only.', busy: false, measured: false },
    { title: 'API', scope: 'TENANT / API DATA', value: count(usage?.executionsToday, 'runs today'), detail: 'Fastify · auth · validation · rate limits. No API fleet metrics.', busy: false, measured: true },
    { title: 'Durable Job Queue', scope: 'TENANT / API DATA', value: count(usage?.queued, 'queued'), detail: 'Postgres executions table. Not a global queue depth.', busy: fresh && (usage?.queued ?? 0) > 0, measured: true },
    { title: 'Worker Pool', scope: 'TENANT / API DATA', value: count(usage?.running, 'running executions'), detail: 'Not worker count, slots, CPU utilization or available capacity.', busy: fresh && (usage?.running ?? 0) > 0, measured: true },
    { title: 'Sandboxes', scope: 'STATIC / UNINSTRUMENTED', value: 'Isolated code runs', detail: 'nsjail + per-run cgroup; dev Docker fallback. Host metrics not exposed.', busy: false, measured: false },
    { title: 'Results', scope: 'RECENT TENANT SAMPLE', value: statuses ? Object.entries(statuses).map(([status, n]) => `${n} ${status}`).join(' · ') || 'No terminal rows in sample' : 'Not observed', detail: `Latest 8 executions, not all-time totals.${listFresh ? '' : ' Last known / unavailable.'}`, busy: false, measured: false },
  ];

  return (
    <Card title="01 / Execution architecture · tenant activity">
      <FlowRow>
        <Text style={common.eyebrow}>OBSERVE FIRST · NO LOAD REQUIRED</Text>
        <Text style={common.muted}>{tenantName || 'Current tenant'}</Text>
      </FlowRow>
      <Text style={common.text}>Live polling · ~10 s refresh, not streaming. {age === null ? 'Awaiting first tenant snapshot.' : `Usage observed ${age} s ago · ${fresh ? 'recent snapshot' : 'STALE / paused / unavailable'}.`}</Text>
      <Text style={common.muted}>Observer: {activity.mode}. {['validating', 'running', 'draining'].includes(experiment.phase) ? 'Passive GETs paused; using load-controller usage snapshots. Recent execution list remains last known.' : 'Authenticated read-only monitoring works independently of the load-target guard.'}</Text>
      {telemetry.cooldown && <Notice>Shared HTTP 429 cooldown: {Math.ceil((experiment.cooldownUntil - activity.now) / 1000)} s. No extra observer reads or load preflight.</Notice>}
      {(activity.error || telemetry.error) && <Notice tone="error">{activity.error || telemetry.error}</Notice>}
      <Text style={common.muted}>Swipe / scroll horizontally to follow the directed execution path →</Text>
      <ScrollView horizontal accessibilityLabel="Execution architecture canvas. Scroll horizontally for all six stages." contentContainerStyle={{ paddingVertical: 10 }}>
        <View style={{ gap: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {nodes.map((node, index) => (
              <View key={node.title} style={{ flexDirection: 'row', alignItems: 'center' }}>
                {index > 0 && <View style={{ width: 28, alignItems: 'center' }}><Text style={{ color: colors.faint, fontSize: 22 }}>→</Text></View>}
                <View style={{ width: 142, minHeight: 238, padding: 12, gap: 12, borderRadius: 12, borderWidth: 1, borderColor: node.busy || (recent && node.measured) ? colors.accent : colors.border, backgroundColor: colors.panel }}>
                  <Text style={[common.eyebrow, { fontSize: 9, lineHeight: 14 }]}>{node.scope}</Text>
                  <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                    <View style={{ width: recent && node.measured ? 9 : 6, height: recent && node.measured ? 9 : 6, borderRadius: 5, backgroundColor: node.busy || (recent && node.measured) ? colors.accent : colors.faint }} />
                    <Text accessibilityRole="header" style={[common.text, { flexShrink: 1, fontFamily: font.semibold }]}>{node.title}</Text>
                  </View>
                  <Text style={[common.text, { fontFamily: mono, fontSize: 13 }]}>{node.value}</Text>
                  <Text style={[common.muted, { fontSize: 12, lineHeight: 18 }]}>{node.detail}</Text>
                  {node.title === 'Worker Pool' || node.title === 'Durable Job Queue' ? <Text style={[common.eyebrow, { color: node.busy ? colors.accent : colors.faint }]}>{fresh ? node.busy ? 'ACTIVITY OBSERVED' : 'NO TENANT ACTIVITY' : 'UNKNOWN / LAST KNOWN'}</Text> : null}
                </View>
              </View>
            ))}
          </View>
          <View style={{ marginHorizontal: 170, height: 30, borderLeftWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'flex-end' }}>
            <Text style={[common.muted, { fontSize: 11, backgroundColor: colors.panel }]}>↓ API + worker dependencies · static connections, not traces ↓</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 16, paddingTop: 18, paddingHorizontal: 170 }}>
            {[
              ['Postgres', 'Metadata + durable queue', 'API ↔ DB · Workers → fenced SQL functions'],
              ['Redis', 'Cache · rate limit · wake hints', 'API + Workers ↔ advisory cache / pub-sub'],
              ['S3 / MinIO', 'Source · logs · result objects', 'API + Workers ↔ object storage'],
            ].map(([name, description, connection]) => (
              <View key={name} style={{ width: 206, padding: 14, gap: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: 12 }}>
                <Text style={[common.text, { fontFamily: font.semibold }]}>{name}</Text>
                <Text style={common.muted}>{description}</Text>
                <Text style={[common.muted, { fontSize: 11 }]}>{connection}</Text>
                <Text style={common.eyebrow}>TELEMETRY: NOT EXPOSED</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
      <Text style={common.muted}>Legend: blue = observed busy tenant queue / executions; neutral = idle only when measured, otherwise static / unknown. A brief blue snapshot pulse marks a received usage observation, NOT an individual request trace or health check. Arrows describe the documented logical lifecycle, not direct client-to-worker connections.</Text>
      <Text style={common.muted}>Whole-system worker count, CPU / memory utilization, database / storage health and autoscaling are not exposed here. Autoscaling is not implemented. A successful run is an execution outcome, not proof of platform health.</Text>
      <FlowRow>
        <Text style={common.text}>Tenant CPU time: {usage ? `${(usage.totalCpuMs / 1000).toFixed(1)} s${fresh ? '' : ' (last known)'}` : '—'} · success / 24 h: {usage?.successRate24h === null ? 'No samples' : usage?.successRate24h === undefined ? '—' : `${Math.round(usage.successRate24h * 100)}%${fresh ? '' : ' (last known)'}`}</Text>
        <Button compact label="Drill down: tenant history" href="/history" />
      </FlowRow>
      <Text style={common.eyebrow}>RECENT TENANT EXECUTIONS · {listFresh ? 'RECENT POLLED SAMPLE' : 'LAST KNOWN / NOT LOADED'}</Text>
      {activity.executions === null ? <Text style={common.muted}>Waiting for /v1/executions. Missing data is not zero activity.</Text> : !activity.executions.length ? <Text style={common.muted}>No rows returned in the latest sample. This is not a whole-system idle signal.</Text> : activity.executions.map((row) => (
        <View key={row.id} style={{ gap: 6, paddingVertical: 8, borderTopWidth: 1, borderColor: colors.border }}>
          <Text selectable style={[common.text, { fontFamily: mono, fontSize: 12 }]}>{row.id} · {row.status}{listFresh ? '' : ' · last known'}</Text>
          <Text style={common.muted}>{row.language} · wall {row.wallMs === null ? 'not reported' : `${row.wallMs} ms`} · CPU {row.cpuMs === null ? 'not reported' : `${row.cpuMs} ms`} · peak memory {row.peakMemoryBytes === null ? 'not reported' : `${(row.peakMemoryBytes / 1048576).toFixed(1)} MiB`} (per execution, not host usage)</Text>
          <Button compact label="Inspect execution & attempts" href={{ pathname: '/execution', params: { id: row.id } }} />
        </View>
      ))}
    </Card>
  );
}
