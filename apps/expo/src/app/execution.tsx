import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { AppScreen, Card, FlowRow, ResourceState } from '@/components/AppScreen';
import { Button, Notice } from '@/components/ui';
import { RunOutput } from '@/components/RunOutput';
import { useGet, useLiveRun } from '@/lib/useResource';
import { terminal, type Source } from '@/lib/types';
import { useAuth } from '@/state/AuthProvider';
import { useTheme } from '@/state/ThemeProvider';
import { describeError } from '@/lib/client';
import { mono } from '@/theme';
export default function ExecutionScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const live = useLiveRun(id || null);
  const source = useGet<Source>(`/v1/executions/${encodeURIComponent(id)}/source`, {}, 0, !!id);
  const { api } = useAuth();
  const { common, colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const e = live.data?.execution.id === id ? live.data.execution : undefined;
  const act = async (rerun: boolean) => {
    setBusy(true);
    setMessage('');
    try {
      if (rerun && source.data) {
        const result = await api.request<{ id: string }>('POST', '/v1/executions', { body: source.data });
        router.replace({ pathname: '/execution', params: { id: result.id } });
      } else {
        await api.request('POST', `/v1/executions/${encodeURIComponent(id)}/cancel`);
        setMessage('Cancellation requested. The worker’s final status will appear here.');
        live.reload();
      }
    } catch (err) {
      setMessage(describeError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AppScreen title="Execution details" subtitle={id || 'Open a run from History.'}>
      {!id ? (
        <Notice>No execution ID was provided.</Notice>
      ) : (
        <>
          <FlowRow>
            <Button label="Back to history" href="/history" />
            <Button label="Refresh result" onPress={live.reload} />
            {e && !terminal(e.status) && (
              <Button
                label="Cancel execution"
                disabled={busy || e.cancelRequested}
                onPress={() => {
                  void act(false);
                }}
              />
            )}
            <Button
              label="Rerun submitted source"
              disabled={busy || !source.data}
              onPress={() => {
                void act(true);
              }}
              variant="primary"
            />
          </FlowRow>
          {!!message && <Notice>{message}</Notice>}
          <Card title="Outcome & output">
            <ResourceState resource={live} />
            {live.data && e && <RunOutput data={live.data} />}
          </Card>
          <Card title="Submitted source">
            <ResourceState resource={source} />
            {source.data && (
              <>
                <Text style={common.muted}>
                  Entry: {source.data.entryFile} · {source.data.language} · timeout{' '}
                  {source.data.limits.timeoutMs} ms · memory {source.data.limits.memoryMb} MiB · CPU{' '}
                  {(source.data.limits.cpuMsPerSec ?? 1000) / 10}% of one core ·{' '}
                  {source.data.limits.pids ?? 64} processes/threads · internet{' '}
                  {source.data.network ? 'On' : 'Off'}
                </Text>
                {source.data.files.map((file) => (
                  <View key={file.path} style={{ gap: 8 }}>
                    <Text style={common.eyebrow}>{file.path}</Text>
                    <Text
                      selectable
                      style={{ fontFamily: mono, color: colors.text, fontSize: 14, lineHeight: 22, padding: 12, backgroundColor: colors.raised, borderRadius: 10 }}
                    >
                      {file.content || '(empty)'}
                    </Text>
                  </View>
                ))}
                <Text style={common.eyebrow}>STANDARD INPUT</Text>
                <Text selectable style={common.text}>
                  {source.data.stdin || '(empty)'}
                </Text>
              </>
            )}
          </Card>
          {e && (
            <Card title="Attempts & timeline">
              {e.attempts.length === 0 && <Text style={common.muted}>No worker attempt yet.</Text>}
              {e.attempts.map((attempt) => (
                <Text key={attempt.attempt} selectable style={common.muted}>
                  #{attempt.attempt} · {attempt.workerId} · {attempt.outcome || 'in progress'} · exit{' '}
                  {attempt.exitCode ?? '—'}
                </Text>
              ))}
              {e.events.map((event) => (
                <Text key={event.id} style={common.muted}>
                  {new Date(event.at).toLocaleString()} · {event.fromStatus ?? 'NEW'} → {event.toStatus} ·
                  attempt {event.attempt}
                </Text>
              ))}
            </Card>
          )}
        </>
      )}
    </AppScreen>
  );
}
