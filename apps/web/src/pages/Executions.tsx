import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ExecutionStatus, LanguageId } from '@engine/shared';
import { LANGUAGES, LANGUAGE_IDS } from '@shared/languages.ts';
import { EXECUTION_STATES } from '@shared/states.ts';
import { api } from '../api/endpoints.ts';
import { ExecutionsTable } from '../components/ExecutionsTable.tsx';
import { Button, Card, ErrorNotice, Field, Input, Select } from '../components/ui.tsx';

interface Filters {
  status: ExecutionStatus | '';
  language: LanguageId | '';
  from: string;
  to: string;
}

const dayStart = (d: string) => (d ? new Date(`${d}T00:00:00`).toISOString() : undefined);
const dayEnd = (d: string) => (d ? new Date(`${d}T23:59:59.999`).toISOString() : undefined);

export function ExecutionsPage() {
  const [filters, setFilters] = useState<Filters>({ status: '', language: '', from: '', to: '' });
  // Cursor stack: index 0 is the first page (no cursor).
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const cursor = cursors[cursors.length - 1];

  const list = useQuery({
    queryKey: ['executions', filters, cursor],
    queryFn: () =>
      api.listExecutions({
        status: filters.status || undefined,
        language: filters.language || undefined,
        from: dayStart(filters.from),
        to: dayEnd(filters.to),
        cursor,
        limit: 25,
      }),
    placeholderData: keepPreviousData,
  });

  const update = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setCursors([undefined]);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Executions</h1>
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Status">
            <Select value={filters.status} onChange={(e) => update({ status: e.target.value as Filters['status'] })}>
              <option value="">All</option>
              {EXECUTION_STATES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </Field>
          <Field label="Language">
            <Select value={filters.language} onChange={(e) => update({ language: e.target.value as Filters['language'] })}>
              <option value="">All</option>
              {LANGUAGE_IDS.map((id) => (
                <option key={id} value={id}>{LANGUAGES[id].label}</option>
              ))}
            </Select>
          </Field>
          <Field label="From">
            <Input type="date" value={filters.from} onChange={(e) => update({ from: e.target.value })} />
          </Field>
          <Field label="To">
            <Input type="date" value={filters.to} onChange={(e) => update({ to: e.target.value })} />
          </Field>
        </div>
        <ErrorNotice error={list.error} />
        {list.data && <ExecutionsTable items={list.data.items} />}
        <div className="mt-4 flex items-center gap-2">
          <Button variant="secondary" disabled={cursors.length <= 1} onClick={() => setCursors((c) => c.slice(0, -1))}>
            ← Previous
          </Button>
          <span className="text-sm text-slate-500">Page {cursors.length}</span>
          <Button
            variant="secondary"
            disabled={!list.data?.nextCursor}
            onClick={() => list.data?.nextCursor && setCursors((c) => [...c, list.data!.nextCursor!])}
          >
            Next →
          </Button>
        </div>
      </Card>
    </div>
  );
}
