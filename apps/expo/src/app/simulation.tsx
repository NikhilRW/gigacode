import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState, Text, View } from 'react-native';
import { AppScreen, Card, Field, FlowRow } from '@/components/AppScreen';
import { Button, Notice, Pill, SettingToggle } from '@/components/ui';
import { simulationApi } from '@/lib/simulation/api';
import { SIMULATION_LIMITS, SimulationController, simulationMetrics, simulationOrigin } from '@/lib/simulation/controller';
import { useAuth } from '@/state/AuthProvider';
import { useTheme } from '@/state/ThemeProvider';
import { font, mono } from '@/theme';

const milliseconds = (value: number | null) => value === null ? '—' : `${Math.round(value)} ms`;
function publicOrigin(input: string) {
  try {
    const url = new URL(input);
    return ['http:', 'https:'].includes(url.protocol) ? url.origin : 'Not configured';
  } catch { return 'Not configured'; }
}

export default function SimulationScreen() {
  const { api, me, signedIn } = useAuth();
  const tenantId = signedIn ? me?.tenant.id ?? '' : '';
  const userId = signedIn ? me?.user.id ?? '' : '';
  // Constructor is inert: mounting, rendering and reconnecting cannot submit jobs.
  const controller = useMemo(() => new SimulationController(simulationApi(api), { tenantId, userId }), [api, tenantId, userId]);
  return (
    <AppScreen title="Simulation lab" subtitle="Small, real workloads. Live outcomes. Deliberately bounded.">
      <SimulationPanel key={`${api.baseUrl}:${tenantId}:${userId}`} controller={controller} origin={api.baseUrl} tenantName={me?.tenant.name ?? ''} tenantId={tenantId} />
    </AppScreen>
  );
}

function SimulationPanel({ controller, origin, tenantName, tenantId }: {
  controller: SimulationController; origin: string; tenantName: string; tenantId: string;
}) {
  const { colors, common } = useTheme();
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const metrics = simulationMetrics(state);
  const [rate, setRate] = useState('0.2');
  const [duration, setDuration] = useState('30');
  const [cap, setCap] = useState('6');
  const [consent, setConsent] = useState({ controller, authorized: false, dedicated: false });
  const authorized = consent.controller === controller && consent.authorized;
  const dedicated = consent.controller === controller && consent.dedicated;
  const allowedOrigin = simulationOrigin(origin);
  const idle = state.phase === 'idle';
  const active = ['validating', 'running', 'draining'].includes(state.phase);

  useEffect(() => controller.attach(), [controller]);
  useFocusEffect(useCallback(() => {
    const listener = AppState.addEventListener('change', (next) => {
      if (next !== 'active') controller.stop('App backgrounded. Production stopped; cancelling owned jobs.');
    });
    return () => {
      listener.remove();
      controller.stop('Screen left. Production stopped; cancelling owned jobs.');
    };
  }, [controller]));

  const facts = [
    ['Submitted', metrics.submitted, `${metrics.attempts} POST attempts / ${state.plan?.maxJobs ?? cap} cap`],
    ['Completed', metrics.completed, 'Confirmed SUCCESS'],
    ['Failed', metrics.failed, 'FAILED / TIMEOUT / DEAD_LETTERED'],
    ['Rate limited', state.rateLimited, 'HTTP 429 responses, any lab request'],
    ['Pending / running', `${metrics.pending} / ${metrics.running}`, `${metrics.submitting} create request in flight`],
    ['Observed throughput', `${metrics.throughput.toFixed(2)} /s`, 'Terminal outcomes / elapsed time; includes cancellations'],
  ];

  return (
    <>
      <Notice tone="error">REAL WORKLOAD • Consumes tenant quota and worker capacity. Remote / production API origins are blocked. A loopback URL can still proxy production: authorization is your responsibility.</Notice>
      <Card title="01 / Guarded launch">
        <Text style={common.eyebrow}>CAPTURED API ORIGIN</Text>
        <Text selectable style={[common.text, { fontFamily: mono }]}>{publicOrigin(origin)}</Text>
        {!allowedOrigin && <Notice tone="error">This target is blocked. Choose a canonical loopback API in Connection settings; remote origins cannot submit simulation jobs.</Notice>}
        <Text style={common.muted}>Tenant: {tenantName || 'Not signed in'} · {tenantId || 'unavailable'}</Text>
        <Text style={common.muted}>Dedicated-tenant isolation cannot be verified by this API. Both confirmations are attestations, not server-enforced isolation. Start checks current identity, limits, and an empty running/queued backlog.</Text>
        <SettingToggle label="I am authorized to load this isolated local / staging environment" description="Loopback targets only. Never a production proxy or shared environment." value={authorized} onValueChange={(value) => setConsent({ controller, authorized: value, dedicated })} disabled={!idle} />
        <SettingToggle label="This is a dedicated test tenant with no other activity" description="I own this tenant and will reconcile any unknown submissions in History." value={dedicated} onValueChange={(value) => setConsent({ controller, authorized, dedicated: value })} disabled={!idle} />
        <FlowRow>
          <Field label="Requests / second" keyboardType="decimal-pad" value={rate} onChangeText={setRate} editable={idle} style={{ minWidth: 140 }} />
          <Field label="Duration (seconds)" keyboardType="number-pad" value={duration} onChangeText={setDuration} editable={idle} style={{ minWidth: 140 }} />
          <Field label="Total POST attempt cap" keyboardType="number-pad" value={cap} onChangeText={setCap} editable={idle} style={{ minWidth: 140 }} />
        </FlowRow>
        <Text style={common.muted}>Hard limits: {SIMULATION_LIMITS.minRate}–{SIMULATION_LIMITS.maxRate} req/s · 5–60 s · 30 attempts · at most 2 outstanding jobs (or the lower tenant cap). One create request at a time; no retries or catch-up bursts. Add load never extends the budget.</Text>
        <FlowRow>
          <Button label="Start real workload" icon="play" variant="primary" disabled={!idle || !allowedOrigin || !tenantId || !authorized || !dedicated} onPress={() => {
            void controller.start({ rate: Number(rate), durationSeconds: Number(duration), maxJobs: Number(cap) }, { authorizedEnvironment: authorized, dedicatedTenant: dedicated });
          }} />
          <Button label="Add load +0.1 req/s" icon="plus" disabled={state.phase !== 'running' || (state.plan?.rate ?? 1) >= 1} onPress={() => controller.addLoad()} />
          <Button label="Stop & cancel owned jobs" icon="square" variant="danger" disabled={!active || state.phase === 'draining'} onPress={() => controller.stop()} />
        </FlowRow>
        <FlowRow><Pill label={state.phase.toUpperCase()} dot /><Text style={common.text}>{Math.floor(state.elapsedMs / 1000)} s elapsed · target {state.plan?.rate ?? rate} req/s</Text></FlowRow>
        <Notice>{state.reason}</Notice>
        {state.cooldownMs > 0 && state.phase !== 'finished' && <Notice>Rate-limit cooldown: {Math.ceil(state.cooldownMs / 1000)} s. No automatic resume of production.</Notice>}
        {state.phase === 'finished' && <Text style={common.muted}>One bounded experiment per screen instance. Reconcile unresolved runs before reopening this route for another experiment.</Text>}
      </Card>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {facts.map(([label, value, hint]) => (
          <View key={String(label)} style={{ flexBasis: '45%', flexGrow: 1, minWidth: 140 }}>
            <Card>
              <Text style={common.eyebrow}>{label}</Text>
              <Text style={[common.text, { fontFamily: font.semibold, fontSize: 28, lineHeight: 36 }]}>{value}</Text>
              <Text style={common.muted}>{hint}</Text>
            </Card>
          </View>
        ))}
      </View>

      <Card title="02 / Timing & safety ledger">
        <Text style={common.text}>Mean accepted submission HTTP latency: {milliseconds(metrics.submissionMs)}</Text>
        <Text style={common.text}>Mean observed end-to-end latency: {milliseconds(metrics.observedEndToEndMs)}</Text>
        <Text style={common.muted}>POST start → first fresh terminal poll. Includes submission, queueing and up to a polling interval; not precise server execution time.</Text>
        <Text style={common.text}>Mean server execution wall time: {milliseconds(metrics.wallMs)}</Text>
        <Text style={common.muted}>Only API-reported wallMs samples. No fabricated worker CPU utilization, global capacity or autoscaling metrics.</Text>
        <Text style={common.text}>{metrics.cancelled} cancelled · {metrics.rejected} rejected POSTs · {metrics.unknown} unknown submissions · {metrics.outstanding} outstanding known / in-flight</Text>
        <Text style={common.muted}>Stop immediately disables new submissions. Cancellation acknowledgement is not completion; drain polls wait for final statuses for up to 90 s. In-flight creates are retained, and late returned IDs are cancelled. Lost responses may leave unknown jobs: reconcile History.</Text>
        {state.issues.map((issue) => <Notice key={issue} tone="error">{issue}</Notice>)}
      </Card>

      <Card title="03 / Actual test executions">
        {!state.probes.length && <Text style={common.muted}>No submissions. Nothing runs until you explicitly confirm and press Start.</Text>}
        {state.probes.map((probe) => (
          <View key={probe.sequence} style={{ gap: 8, paddingVertical: 12, borderTopWidth: 1, borderColor: colors.border }}>
            <FlowRow><Text style={common.eyebrow}>PROBE {String(probe.sequence).padStart(2, '0')}</Text><Pill label={probe.status} dot /></FlowRow>
            <Text selectable style={[common.muted, { fontFamily: mono }]}>{probe.id ?? (probe.status === 'UNKNOWN' ? 'Unknown ID — reconcile History' : 'Awaiting accepted ID')}</Text>
            <Text style={common.muted}>HTTP {milliseconds(probe.submissionMs ?? null)} · wall {milliseconds(probe.wallMs ?? null)} · observed E2E {milliseconds(probe.observedEndToEndMs ?? null)}</Text>
            {probe.cancellation !== 'none' && <Text style={[common.text, { color: probe.cancellation === 'failed' ? colors.error : colors.warning }]}>Cancellation: {probe.cancellation}{probe.cancellation === 'requested' ? ' — awaiting terminal status' : ''}</Text>}
            {(probe.stale || probe.monitorError) && <Text style={[common.muted, { color: colors.warning }]}>{probe.stale ? 'Stale API response — not counted as a confirmed outcome. ' : ''}{probe.monitorError}</Text>}
            {probe.id && <Button compact label="Open actual execution" href={{ pathname: '/execution', params: { id: probe.id } }} />}
          </View>
        ))}
        <FlowRow><Button label="Tenant history" href="/history" /><Button label="Usage dashboard" href="/dashboard" /><Button label="Connection settings" href="/connection" /></FlowRow>
      </Card>

      <Card title="Tenant context / not experiment-only">
        {state.usage ? <Text style={common.text}>{state.usage.executionsToday} executions today · {state.usage.running} running · {state.usage.queued} queued · {state.usage.limits.maxExecPerMin}/min tenant limit</Text> : <Text style={common.muted}>Loaded from /v1/usage only after Start passes the environment and attestation gates.</Text>}
        <Text style={common.muted}>Tenant snapshots refresh every ~10 s during active monitoring. They may include other activity and are not global worker metrics. Test-only totals above are computed exclusively from this controller&apos;s returned IDs.</Text>
        <Text style={common.muted}>Probe: fixed Python checksum over 20,000 integers · network off · 1 s timeout · 64 MiB · 10% of one CPU core maximum. Output and detailed results are available on each execution page.</Text>
      </Card>
    </>
  );
}
