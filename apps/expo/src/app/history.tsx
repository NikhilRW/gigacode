import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { AppScreen, Card, Field, FlowRow, ResourceState } from '@/components/AppScreen';
import { Button, Notice } from '@/components/ui';
import { RunList } from '@/components/RunList';
import { useGet } from '@/lib/useResource';
import { statuses, type ExecutionList, type Language, type Status } from '@/lib/types';
import { languageIds, languages } from '@/lib/languages';
import { useTheme } from '@/state/ThemeProvider';
export default function History() {
  const { common } = useTheme();
  const [status, setStatus] = useState<Status>(); const [language, setLanguage] = useState<Language>();
  const [search, setSearch] = useState(''); const [q, setQ] = useState(''); const [error, setError] = useState(''); const [pages, setPages] = useState<string[]>([]);
  const [fromInput, setFrom] = useState(''); const [toInput, setTo] = useState('');
  const [dates, setDates] = useState<{ from?: string; to?: string }>({});
  const runs = useGet<ExecutionList>('/v1/executions', { status, language, q, ...dates, cursor: pages.at(-1), limit: 20 }, 5000);
  const searchRuns = () => {
    const prefix = search.trim();
    if (prefix && !/^[0-9a-f-]{1,36}$/i.test(prefix)) { setError('Use a run ID prefix: hexadecimal characters and dashes, at most 36 characters.'); return; }
    try {
      const parse = (value: string) => {
        if (!value.trim()) return undefined;
        if (!/^\d{4}-\d{2}-\d{2}T/.test(value.trim())) throw new Error('Use an ISO date and time, for example 2026-11-02T09:00:00Z.');
        const date = new Date(value.trim());
        if (!Number.isFinite(date.getTime())) throw new Error('Enter a valid date and time.');
        return date.toISOString();
      };
      const from = parse(fromInput), to = parse(toInput);
      if (from && to && from > to) throw new Error('The end must be after the start.');
      setDates({ from, to }); setQ(prefix.toLowerCase()); setPages([]); setError('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Check the dates.'); }
  };
  return <AppScreen title="Execution history" subtitle="Every run keeps its source, outcome, and metrics. Filters and cursor pagination are evaluated by the API.">
    <Card title="Find a run"><Field label="Run ID or prefix" value={search} onChangeText={setSearch} placeholder="First hexadecimal characters of a run ID" />
      <FlowRow><Field label="From · optional ISO time" value={fromInput} onChangeText={setFrom} placeholder="2026-11-02T00:00:00Z" /><Field label="To · optional ISO time" value={toInput} onChangeText={setTo} placeholder="2026-11-03T00:00:00Z" /></FlowRow>
      <FlowRow><Button label="Search" onPress={searchRuns} /><Button label="Reset filters" onPress={() => { setStatus(undefined); setLanguage(undefined); setQ(''); setSearch(''); setFrom(''); setTo(''); setDates({}); setPages([]); setError(''); }} /></FlowRow>
      <ScrollView horizontal contentContainerStyle={{ gap: 6 }}><FlowRow><Button label="All statuses" variant={!status ? 'primary' : 'secondary'} onPress={() => { setStatus(undefined); setPages([]); }} />{statuses.map(value => <Button key={value} label={value} variant={status === value ? 'primary' : 'secondary'} onPress={() => { setStatus(value); setPages([]); }} />)}</FlowRow></ScrollView>
      <FlowRow><Button label="All languages" variant={!language ? 'primary' : 'secondary'} onPress={() => { setLanguage(undefined); setPages([]); }} />{languageIds.map(value => <Button key={value} label={languages[value].label} variant={value === language ? 'primary' : 'secondary'} onPress={() => { setLanguage(value); setPages([]); }} />)}</FlowRow>
      {!!error && <Notice>{error}</Notice>}
    </Card>
    <Card title={`Runs · page ${pages.length + 1}`}><ResourceState resource={runs} />{runs.data && <RunList items={runs.data.items} />}<FlowRow><Button label="Previous page" disabled={!pages.length || runs.loading} onPress={() => setPages(values => values.slice(0, -1))} /><Button label="Next page" disabled={!runs.data?.nextCursor || runs.loading} onPress={() => { const cursor = runs.data?.nextCursor; if (cursor) setPages(values => [...values, cursor]); }} /><Button label="Refresh" onPress={runs.reload} /></FlowRow><Text style={common.muted}>Live updates while focused · 20 runs per page. No offline history cache is kept.</Text></Card>
  </AppScreen>;
}
