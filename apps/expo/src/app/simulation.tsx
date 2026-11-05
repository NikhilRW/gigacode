import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState, Text, View } from 'react-native';
import { AppScreen, Card, Field, FlowRow } from '@/components/AppScreen';
import { Button, Notice, Pill, SettingToggle } from '@/components/ui';
import { ArchitectureCanvas } from '@/components/simulation/ArchitectureCanvas';
import { getBrowserOrigin } from '@/lib/client';
import { simulationApi } from '@/lib/simulation/api';
import { SIMULATION_LIMITS, SimulationController, simulationMetrics } from '@/lib/simulation/controller';
import { TenantActivityObserver } from '@/lib/simulation/observer';
import { simulationTarget } from '@/lib/simulation/target';
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
  const browserOrigin = getBrowserOrigin();
  const capturedApi = useMemo(() => simulationApi(api), [api]);
  const controller = useMemo(() => new SimulationController(capturedApi, { tenantId, userId, browserOrigin }), [capturedApi, tenantId, userId, browserOrigin]);
  const observer = useMemo(() => new TenantActivityObserver(capturedApi, controller, tenantId), [capturedApi, controller, tenantId]);
  return (
    <AppScreen title="Simulation lab" subtitle="Follow the execution architecture. Observe real tenant activity first; add bounded load only when authorized.">
      <SimulationPanel key={`${api.baseUrl}:${tenantId}:${userId}`} controller={controller} observer={observer} browserOrigin={browserOrigin} origin={api.baseUrl} tenantName={me?.tenant.name ?? ''} tenantId={tenantId} />
    </AppScreen>
  );
}

function SimulationPanel({ controller, observer, browserOrigin, origin, tenantName, tenantId }: {
  controller: SimulationController; observer: TenantActivityObserver; browserOrigin: string | null; origin: string; tenantName: string; tenantId: string;
}) {
  const { colors, common } = useTheme();
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const activity = useSyncExternalStore(observer.subscribe, observer.getSnapshot, observer.getSnapshot);
  const metrics = simulationMetrics(state);
  const [rate, setRate] = useState('0.2');
  const [duration, setDuration] = useState('30');
  const [cap, setCap] = useState('6');
  const [consent, setConsent] = useState({ controller, authorized: false, dedicated: false, confirmation: '' });
  const authorized = consent.controller === controller && consent.authorized;
  const dedicated = consent.controller === controller && consent.dedicated;
  const confirmation = consent.controller === controller ? consent.confirmation : '';
  const target = simulationTarget(origin, browserOrigin);
  const allowedOrigin = target.origin;
  const confirmedTarget = target.kind !== 'codespaces' || confirmation === target.origin;
  const idle = state.phase === 'idle';
  const active = ['validating', 'running', 'draining'].includes(state.phase);

  useEffect(() => {
    const detachController = controller.attach();
    const detachObserver = observer.attach();
    return () => { detachObserver(); detachController(); };
  }, [controller, observer]);
  useFocusEffect(useCallback(() => {
    const updateForeground = () => observer.setForeground(AppState.currentState === 'active' && (typeof document === 'undefined' || document.visibilityState !== 'hidden'));
    updateForeground();
    const listener = AppState.addEventListener('change', (next) => {
      observer.setForeground(next === 'active' && (typeof document === 'undefined' || document.visibilityState !== 'hidden'));
      if (next !== 'active') controller.stop('App backgrounded. Production stopped; cancelling owned jobs.');
    });
    const visibility = () => {
      updateForeground();
      if (document.visibilityState === 'hidden') controller.stop('Browser tab hidden. Production stopped; cancelling owned jobs.');
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visibility);
    return () => {
      listener.remove();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visibility);
      observer.setForeground(false);
      controller.stop('Screen left. Production stopped; cancelling owned jobs.');
    };
  }, [controller, observer]));

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
      <ArchitectureCanvas activity={activity} experiment={state} tenantName={tenantName} />
      <Notice>Observation is READ-ONLY. Start creates REAL WORKLOAD and consumes tenant quota / worker resources. Host matching never proves ownership or isolation; even loopback or a same-workspace proxy can point to production.</Notice>
      <Card title="02 / Optional bounded load controls">
        <Text style={common.eyebrow}>CAPTURED API ORIGIN</Text>
        <Text selectable style={[common.text, { fontFamily: mono }]}>{publicOrigin(origin)}</Text>
        <Notice tone={allowedOrigin ? undefined : 'error'}>{target.label}{allowedOrigin ? ' — host relationship only, NOT a safety verification.' : ''}</Notice>
        <Text style={common.muted}>This is a code-level load restriction, not a network diagnosis. In a browser, localhost means your computer; a forwarded API URL points to the Codespace. Codespaces load requires the API and this browser page to be HTTPS forwarded ports in the same workspace. Read-only observation may use your configured remote API; CORS, port visibility and authentication still apply.</Text>
        <Text style={common.muted}>Tenant: {tenantName || 'Not signed in'} · {tenantId || 'unavailable'}</Text>
        <Text style={common.muted}>Dedicated-tenant isolation cannot be verified by this API. Both confirmations are attestations, not server-enforced isolation. Start checks current identity, limits, and an empty running/queued backlog.</Text>
        <SettingToggle label="I am authorized to load this isolated local / staging environment" description="Never a production proxy or shared environment. Ownership / isolation are user-attested, not server-proven." value={authorized} onValueChange={(value) => setConsent({ controller, authorized: value, dedicated, confirmation })} disabled={!idle} />
        <SettingToggle label="This is a dedicated test tenant with no other activity" description="I own this tenant and will reconcile any unknown submissions in History." value={dedicated} onValueChange={(value) => setConsent({ controller, authorized, dedicated: value, confirmation })} disabled={!idle} />
        {target.kind === 'codespaces' && <Field label="Type the exact API origin to confirm forwarded load target" placeholder={target.origin} value={confirmation} onChangeText={(value) => setConsent({ controller, authorized, dedicated, confirmation: value })} editable={idle} />}
        <FlowRow>
          <Field label="Requests / second" keyboardType="decimal-pad" value={rate} onChangeText={setRate} editable={idle} style={{ minWidth: 140 }} />
          <Field label="Duration (seconds)" keyboardType="number-pad" value={duration} onChangeText={setDuration} editable={idle} style={{ minWidth: 140 }} />
          <Field label="Total POST attempt cap" keyboardType="number-pad" value={cap} onChangeText={setCap} editable={idle} style={{ minWidth: 140 }} />
        </FlowRow>
        <Text style={common.muted}>Hard limits: {SIMULATION_LIMITS.minRate}–{SIMULATION_LIMITS.maxRate} req/s · 5–60 s · 30 attempts · at most 2 outstanding jobs (or the lower tenant cap). One create request at a time; no retries or catch-up bursts. Add load never extends the budget.</Text>
        <FlowRow>
          <Button label="Start real workload" icon="play" variant="primary" disabled={!idle || !allowedOrigin || !tenantId || !authorized || !dedicated || !confirmedTarget || activity.now < state.cooldownUntil} onPress={() => {
            void controller.start({ rate: Number(rate), durationSeconds: Number(duration), maxJobs: Number(cap) }, { authorizedEnvironment: authorized, dedicatedTenant: dedicated, targetOriginConfirmation: confirmation });
          }} />
          <Button label="Add load +0.1 req/s" icon="plus" disabled={state.phase !== 'running' || (state.plan?.rate ?? 1) >= 1} onPress={() => controller.addLoad()} />
          <Button label="Stop & cancel owned jobs" icon="square" variant="danger" disabled={!active || state.phase === 'draining'} onPress={() => controller.stop()} />
        </FlowRow>
        <FlowRow><Pill label={state.phase.toUpperCase()} dot /><Text style={common.text}>{Math.floor(state.elapsedMs / 1000)} s elapsed · target {state.plan?.rate ?? rate} req/s</Text></FlowRow>
        <Notice>{state.reason}</Notice>
        {activity.now < state.cooldownUntil && <Notice>Shared rate-limit cooldown: {Math.ceil((state.cooldownUntil - activity.now) / 1000)} s. No automatic resume of production.</Notice>}
        {state.phase === 'finished' && <Text style={common.muted}>One bounded experiment per screen instance. Reconcile unresolved runs before reopening this route for another experiment.</Text>}
      </Card>

      <Text style={common.eyebrow}>LOCAL EXPERIMENT ONLY · NOT TENANT TOTALS</Text>
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

      <Card title="03 / Experiment timing & safety ledger">
        <Text style={common.text}>Mean accepted submission HTTP latency: {milliseconds(metrics.submissionMs)}</Text>
        <Text style={common.text}>Mean observed end-to-end latency: {milliseconds(metrics.observedEndToEndMs)}</Text>
        <Text style={common.muted}>POST start → first fresh terminal poll. Includes submission, queueing and up to a polling interval; not precise server execution time.</Text>
        <Text style={common.text}>Mean server execution wall time: {milliseconds(metrics.wallMs)}</Text>
        <Text style={common.muted}>Only API-reported wallMs samples. No fabricated worker CPU utilization, global capacity or autoscaling metrics.</Text>
        <Text style={common.text}>{metrics.cancelled} cancelled · {metrics.rejected} rejected POSTs · {metrics.unknown} unknown submissions · {metrics.outstanding} outstanding known / in-flight</Text>
        <Text style={common.muted}>Stop immediately disables new submissions. Cancellation acknowledgement is not completion; drain polls wait for final statuses for up to 90 s. In-flight creates are retained, and late returned IDs are cancelled. Lost responses may leave unknown jobs: reconcile History.</Text>
        {state.issues.map((issue) => <Notice key={issue} tone="error">{issue}</Notice>)}
      </Card>

      <Card title="04 / Owned experiment executions">
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

      <Card title="Probe specification / limitations">
        <Text style={common.muted}>Tenant activity above is independent of this experiment. Experiment totals are computed exclusively from this controller&apos;s returned IDs. No whole-system capacity or safety inference is possible from these endpoints.</Text>
        <Text style={common.muted}>Probe: fixed Python checksum over 20,000 integers · network off · 1 s timeout · 64 MiB · 10% of one CPU core maximum. Output and detailed results are available on each execution page.</Text>
      </Card>
    </>
  );
}
