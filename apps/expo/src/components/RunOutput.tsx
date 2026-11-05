import { Text, View } from 'react-native';
import { useTheme } from '@/state/ThemeProvider';
import { mono, radius } from '@/theme';
import { terminal } from '@/lib/types';
import type { RunData } from '@/lib/useResource';
import { useDrafts } from '@/state/DraftProvider';
import { Notice, Pill, SettingToggle } from './ui';
export function RunOutput({ data }: { data: RunData }) {
  const { colors, common } = useTheme();
  const e = data.execution;
  const { library, configure, ready } = useDrafts();
  const internet = e.network ?? data.result?.network;
  const averageCpu =
    e.cpuMs !== null && e.wallMs !== null && e.wallMs > 0 ? (e.cpuMs / e.wallMs) * 100 : null;
  return (
    <View style={{ gap: 14 }}>
      <Pill label={`${e.status}${e.cancelRequested ? ' · cancellation requested' : ''}`} dot />
      {e.stale && <Notice>Showing the server’s cached status while its database is unavailable.</Notice>}
      <Text selectable style={common.muted}>
        Attempt {e.attempt}/{e.maxAttempts} · {e.language} · {e.entryFile}
      </Text>
      <Text style={common.text}>
        Exit {e.exitCode ?? '—'} · Program internet:{' '}
        {internet === undefined ? 'unknown' : internet ? 'On' : 'Off'}
      </Text>
      {!!e.failureReason && (
        <Notice>
          {e.failureReason}
          {e.termSignal ? ` · ${e.termSignal}` : ''}
        </Notice>
      )}
      {!terminal(e.status) ? (
        <Text style={common.muted}>
          Waiting for the sandbox worker. Status refreshes while this screen is focused. Logs are available
          after artifacts are uploaded.
        </Text>
      ) : (
        <>
          {(['stdout', 'stderr'] as const).map((stream) => (
            <View key={stream} style={{ gap: 7 }}>
              <Text style={common.eyebrow}>{stream.toUpperCase()}</Text>
              <Text
                selectable
                style={{
                  fontFamily: mono,
                  fontSize: 14,
                  lineHeight: 22,
                  color: stream === 'stderr' ? colors.warning : colors.text,
                }}
              >
                {data[stream] === null
                  ? 'No output artifact is available for this execution.'
                  : data[stream].text || '(empty)'}
              </Text>
              {(data[stream]?.truncated || e[`${stream}Truncated`]) && (
                <Notice>{stream} was truncated by the runtime output limit.</Notice>
              )}
            </View>
          ))}
        </>
      )}
      <SettingToggle
        label="Resource usage"
        value={library.showUsage}
        disabled={!ready}
        onValueChange={(showUsage) => configure({ showUsage })}
        description="Measurements for this execution, not live phone or server-wide usage."
      />
      {library.showUsage && (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            <Metric
              label="Wall time"
              value={e.wallMs === null ? '—' : `${e.wallMs} ms`}
              detail={`Run limit ${e.limits.timeoutMs} ms`}
            />
            <Metric
              label="CPU time"
              value={e.cpuMs === null ? '—' : `${e.cpuMs} ms`}
              detail={`Allowance ${(e.limits.cpuMsPerSec ?? 1000) / 10}% of one core`}
            />
            <Metric
              label="Average core use"
              value={averageCpu === null ? '—' : `${averageCpu.toFixed(1)}%`}
              detail="CPU time ÷ wall time, including setup overhead"
            />
            <Metric
              label="Peak memory"
              value={e.peakMemoryBytes === null ? '—' : `${(e.peakMemoryBytes / 1048576).toFixed(1)} MiB`}
              detail={`Run limit ${e.limits.memoryMb} MiB`}
            />
          </View>
          <Text style={common.muted}>
            Process/thread limit: {e.limits.pids ?? 64}. Measurements appear after completion. Compilation
            uses separate time/memory limits. Internet traffic bytes are not measured by this runner.
          </Text>
        </>
      )}
      {terminal(e.status) &&
        (data.result ? (
          <Text style={common.muted}>
            Result: {data.result.status} · stdout {data.result.stdoutBytes} B · stderr{' '}
            {data.result.stderrBytes} B
            {data.result.compile
              ? ` · compile exit ${data.result.compile.exitCode ?? '—'}, ${data.result.compile.wallMs} ms`
              : ''}
          </Text>
        ) : (
          <Text style={common.muted}>Result artifact is not available yet.</Text>
        ))}
    </View>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  const { colors, common } = useTheme();
  return (
    <View
      style={{
        flexGrow: 1,
        flexBasis: 140,
        minWidth: 0,
        gap: 6,
        padding: 13,
        borderRadius: radius,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.raised,
      }}
    >
      <Text style={common.muted}>{label}</Text>
      <Text style={{ color: colors.accent, fontFamily: mono, fontSize: 19 }}>{value}</Text>
      <Text style={common.muted}>{detail}</Text>
    </View>
  );
}
