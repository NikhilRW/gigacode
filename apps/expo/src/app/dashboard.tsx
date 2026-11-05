import { Text, View } from 'react-native';
import { AppScreen, Card, FlowRow, ResourceState } from '@/components/AppScreen';
import { Button } from '@/components/ui';
import { RunList } from '@/components/RunList';
import { useGet } from '@/lib/useResource';
import type { ExecutionList, Timeseries, Usage } from '@/lib/types';
import { useAuth } from '@/state/AuthProvider';
import { useTheme } from '@/state/ThemeProvider';
import { useContentWidth } from '@/components/AppShell';
import { font } from '@/theme';
export default function Dashboard() {
  const { me } = useAuth();
  const { colors, common } = useTheme();
  const width = useContentWidth();
  const usage = useGet<Usage>('/v1/usage', {}, 5000);
  const recent = useGet<ExecutionList>('/v1/executions', { limit: 8 }, 5000);
  const series = useGet<Timeseries>('/v1/usage/timeseries', { hours: 24 }, 30000);
  const onboarding = useGet<{ ranExecution: boolean; createdApiKey: boolean; usedApiKey: boolean }>(
    '/v1/onboarding',
    {},
    10000,
  );
  const u = usage.data;
  return (
    <AppScreen
      title={`Hello, ${me?.user.name || me?.user.email.split('@')[0] || 'curious mind'}.`}
      subtitle="A little code. Safely contained. Your usage and recent activity come directly from your tenant’s API."
    >
      <FlowRow>
        <Button label="New run" href="/" variant="primary" icon="play" />
        <Button label="All history" href="/history" />
      </FlowRow>
      <ResourceState resource={usage} />
      {u && (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
            {[
              ['Runs today', u.executionsToday],
              ['Running / slots', `${u.running} / ${u.limits.maxConcurrent}`],
              ['Queued', u.queued],
              ['CPU time', `${(u.totalCpuMs / 1000).toFixed(1)} s`],
              [
                'Success · 24h',
                u.successRate24h === null ? 'No runs' : `${Math.round(u.successRate24h * 100)}%`,
              ],
            ].map(([label, value]) => (
              <View
                key={label}
                style={{ minWidth: 120, flexBasis: width < 600 ? '45%' : '18%', flexGrow: 1 }}
              >
                <Card>
                  <Text style={common.muted}>{label}</Text>
                  <Text style={[common.text, { fontSize: 24, lineHeight: 30, fontFamily: font.semibold }]}>{value}</Text>
                </Card>
              </View>
            ))}
          </View>
          <Card title="Workspace limits">
            <Text style={common.text}>{me?.tenant.name}</Text>
            <Text style={common.muted}>
              {u.limits.maxExecPerMin} executions/min · {u.limits.maxTimeoutMs} ms timeout ·{' '}
              {u.limits.maxMemoryMb} MiB memory · {(u.limits.maxSourceBytes / 1024).toFixed(0)} KiB source
            </Text>
          </Card>
        </>
      )}
      <Card title="Activity · last 24 hours">
        <ResourceState resource={series} />
        {series.data && (
          <>
            <View
              style={{ flexDirection: 'row', gap: 3, alignItems: 'flex-end', height: 100 }}
              accessibilityLabel="Hourly execution activity"
            >
              {series.data.points.map((point) => {
                const total = point.success + point.failed + point.timeout + point.cancelled + point.other;
                const max = Math.max(
                  1,
                  ...series.data!.points.map((p) => p.success + p.failed + p.timeout + p.cancelled + p.other),
                );
                return (
                  <View
                    key={point.at}
                    accessible
                    accessibilityLabel={`${new Date(point.at).toLocaleString()}: ${total} runs, ${point.failed + point.timeout} failed or timed out`}
                    style={{
                      flex: 1,
                      height: Math.max(3, (total / max) * 90),
                      backgroundColor:
                        point.failed + point.timeout > 0
                          ? colors.warning
                          : total
                            ? colors.accent
                            : colors.border,
                      borderRadius: 3,
                    }}
                  />
                );
              })}
            </View>
            <Text style={common.muted}>
              Neutral: completed activity · amber: failed/timed out in that hour.
            </Text>
          </>
        )}
      </Card>
      <Card title="Your next steps">
        <ResourceState resource={onboarding} />
        {onboarding.data && (
          <>
            {[
              { done: onboarding.data.ranExecution, label: 'Run your first program', href: '/' as const },
              { done: onboarding.data.createdApiKey, label: 'Create an API key', href: '/keys' as const },
              {
                done: onboarding.data.usedApiKey,
                label: 'Use a key from your own client',
                href: '/keys' as const,
              },
            ].map((step) => (
              <Button
                key={step.label}
                label={`${step.done ? '✓' : '→'} ${step.label}`}
                href={step.href}
                variant="ghost"
              />
            ))}
          </>
        )}
      </Card>
      <Card title="Recent executions">
        <ResourceState resource={recent} />
        {recent.data && <RunList items={recent.data.items} />}
      </Card>
    </AppScreen>
  );
}
