import { Text, View } from 'react-native';
import { useTheme } from '@/state/ThemeProvider';
import { mono } from '@/theme';
import { terminal } from '@/lib/types';
import type { RunData } from '@/lib/useResource';
import { Notice, Pill } from './ui';
export function RunOutput({ data }: { data: RunData }) {
  const { colors, common } = useTheme();
  const e = data.execution;
  return <View style={{ gap: 14 }}>
    <Pill label={`${e.status}${e.cancelRequested ? ' · cancellation requested' : ''}`} dot />
    {e.stale && <Notice>Showing the server’s cached status while its database is unavailable.</Notice>}
    <Text selectable style={common.muted}>Attempt {e.attempt}/{e.maxAttempts} · {e.language} · {e.entryFile}</Text>
    <Text style={common.text}>Wall {e.wallMs ?? '—'} ms · CPU {e.cpuMs ?? '—'} ms · Peak {e.peakMemoryBytes === null ? '—' : (e.peakMemoryBytes / 1048576).toFixed(1)} MiB · Exit {e.exitCode ?? '—'}</Text>
    {!!e.failureReason && <Notice>{e.failureReason}{e.termSignal ? ` · ${e.termSignal}` : ''}</Notice>}
    {!terminal(e.status) ? <Text style={common.muted}>Waiting for the sandbox worker. Status refreshes while this screen is focused. Logs are available after artifacts are uploaded.</Text> : <>
      {(['stdout', 'stderr'] as const).map(stream => <View key={stream} style={{ gap: 7 }}><Text style={common.eyebrow}>{stream.toUpperCase()}</Text><Text selectable style={{ fontFamily: mono, fontSize: 16, lineHeight: 25, color: stream === 'stderr' ? colors.warning : colors.text }}>{data[stream] === null ? 'No output artifact is available for this execution.' : data[stream].text || '(empty)'}</Text>{(data[stream]?.truncated || e[`${stream}Truncated`]) && <Notice>{stream} was truncated by the runtime output limit.</Notice>}</View>)}
      {data.result ? <Text style={common.muted}>Result: {data.result.status} · stdout {data.result.stdoutBytes} B · stderr {data.result.stderrBytes} B{data.result.compile ? ` · compile exit ${data.result.compile.exitCode ?? '—'}, ${data.result.compile.wallMs} ms` : ''}</Text> : <Text style={common.muted}>Result artifact is not available yet.</Text>}
    </>}
  </View>;
}
