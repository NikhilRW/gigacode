import { Text, View } from 'react-native';
import { useTheme } from '@/state/ThemeProvider';
import type { Execution } from '@/lib/types';
import { Button, Pill } from './ui';
export function RunList({ items }: { items: Execution[] }) {
  const { colors, common } = useTheme();
  return <View>{items.length === 0 && <Text style={common.muted}>No executions match yet. Start in the workspace or change your filters.</Text>}{items.map(item => <View key={item.id} style={{ gap: 10, paddingVertical: 16, borderBottomWidth: 1, borderColor: colors.border }}>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between', alignItems: 'center' }}><Pill label={item.status} /><Button label={`${item.language} · ${item.id.slice(0, 8)} ↗`} href={{ pathname: '/execution', params: { id: item.id } }} variant="ghost" /></View>
    <Text selectable style={common.muted}>{item.entryFile} · {new Date(item.createdAt).toLocaleString()} · {item.wallMs ?? '—'} ms · exit {item.exitCode ?? '—'}</Text>
  </View>)}</View>;
}
