import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, Search, X } from 'lucide-react';
import { EXECUTION_STATES, isTerminal, type ExecutionStatus } from '@shared/states.ts';
import { LANGUAGES, LANGUAGE_IDS } from '@shared/languages.ts';
import type { LanguageId } from '@engine/shared';
import { api } from '@/api/endpoints';
import { describeError } from '@/api/client';
import { ExecutionsTable } from '@/components/ExecutionsTable';
import { Page, PageHeader } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { STATUS_LABEL } from '@/lib/runStatus';

const ALL = 'all';
const ID_PREFIX = /^[0-9a-f-]{1,36}$/i;

/** Local start and end of a calendar day, as ISO instants for the API. */
const startOfDay = (d: string) => new Date(`${d}T00:00:00`).toISOString();
const endOfDay = (d: string) => new Date(`${d}T23:59:59.999`).toISOString();

export function ExecutionsPage() {
  const [params, setParams] = useSearchParams();
  const rawStatus = params.get('status');
  const rawLanguage = params.get('language');
  const status = EXECUTION_STATES.includes(rawStatus as ExecutionStatus) ? (rawStatus as ExecutionStatus) : undefined;
  const language = LANGUAGE_IDS.includes(rawLanguage as LanguageId) ? (rawLanguage as LanguageId) : undefined;
  const q = params.get('q') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  // `limit` is not shown in the UI; it exists so page size can be changed in the URL (and tested).
  const limit = Math.min(100, Math.max(1, Number(params.get('limit')) || 25));

  const setParam = (key: string, value: string | undefined) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  // Search is debounced so typing doesn't fire a request per keystroke.
  const [search, setSearch] = useState(q);
  useEffect(() => setSearch(q), [q]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (search.trim() !== q) setParam('q', search.trim() || undefined);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);
  const searchInvalid = search.trim().length > 0 && !ID_PREFIX.test(search.trim());
  const activeQ = q && ID_PREFIX.test(q) ? q.toLowerCase() : undefined;

  const filterKey = `${status}|${language}|${activeQ}|${from}|${to}|${limit}`;
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  useEffect(() => setCursors([undefined]), [filterKey]);
  const cursor = cursors[cursors.length - 1];

  const list = useQuery({
    queryKey: ['executions', filterKey, cursor],
    queryFn: () =>
      api.listExecutions({
        status,
        language,
        q: activeQ,
        from: from ? startOfDay(from) : undefined,
        to: to ? endOfDay(to) : undefined,
        cursor,
        limit,
      }),
    placeholderData: keepPreviousData,
    // Poll while anything on the page is still moving.
    refetchInterval: (query) => (query.state.data?.items.some((e) => !isTerminal(e.status)) ? 3000 : false),
  });

  const hasFilters = !!(status || language || activeQ || from || to || search);
  const clearAll = () => {
    setSearch('');
    setParams(new URLSearchParams(limit !== 25 ? { limit: String(limit) } : {}), { replace: true });
  };

  const items = list.data?.items ?? [];
  const invalidRange = !!from && !!to && from > to;
  const pageNumber = useMemo(() => cursors.length, [cursors]);

  return (
    <Page>
      <PageHeader
        title="Runs"
        subtitle="Everything you have run in this workspace, newest first. Open a run to see its output, timeline and source."
        actions={
          <Button asChild size="lg">
            <Link to="/new">
              <Plus aria-hidden /> New run
            </Link>
          </Button>
        }
      />

      <section aria-label="Filters" className="border-t px-4 py-5 lg:px-10">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full space-y-1.5 sm:w-64">
            <Label htmlFor="run-search">Search by run ID</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden />
              <Input
                id="run-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="e.g. 3f2a9c1e"
                className="pl-9 font-mono text-xs"
                aria-invalid={searchInvalid}
                aria-describedby={searchInvalid ? 'run-search-hint' : undefined}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="filter-status">Status</Label>
            <Select value={status ?? ALL} onValueChange={(v) => setParam('status', v === ALL ? undefined : v)}>
              <SelectTrigger id="filter-status" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                {EXECUTION_STATES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="filter-language">Language</Label>
            <Select value={language ?? ALL} onValueChange={(v) => setParam('language', v === ALL ? undefined : v)}>
              <SelectTrigger id="filter-language" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All languages</SelectItem>
                {LANGUAGE_IDS.map((id) => (
                  <SelectItem key={id} value={id}>
                    {LANGUAGES[id].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="filter-from">From</Label>
            <Input id="filter-from" type="date" value={from} max={to || undefined} onChange={(e) => setParam('from', e.target.value || undefined)} className="w-40" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="filter-to">To</Label>
            <Input id="filter-to" type="date" value={to} min={from || undefined} onChange={(e) => setParam('to', e.target.value || undefined)} className="w-40" />
          </div>
          {hasFilters && (
            <Button variant="ghost" onClick={clearAll} className="gap-1.5">
              <X className="size-4" aria-hidden /> Clear filters
            </Button>
          )}
        </div>
        {searchInvalid && (
          <p id="run-search-hint" role="alert" className="mt-2 text-xs text-destructive">
            Run IDs only contain the characters 0-9, a-f and dashes.
          </p>
        )}
        {invalidRange && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            The start date is after the end date, so nothing can match.
          </p>
        )}
      </section>

      <section aria-label="Runs" className="border-t px-4 py-6 lg:px-10">
        {list.isPending ? (
          <div className="space-y-2" data-testid="runs-loading">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        ) : list.isError ? (
          <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-6 text-center">
            <p className="text-sm font-medium text-destructive">Could not load your runs</p>
            <p className="mt-1 text-xs text-muted-foreground">{describeError(list.error)}</p>
            <Button className="mt-4" variant="outline" size="sm" onClick={() => void list.refetch()}>
              Try again
            </Button>
          </div>
        ) : items.length === 0 ? (
          hasFilters ? (
            <div className="rounded-lg border border-dashed p-10 text-center">
              <p className="text-sm font-medium">No runs match these filters</p>
              <p className="mt-1 text-xs text-muted-foreground">Try a different status or date range, or clear the filters.</p>
              <Button className="mt-4" variant="outline" size="sm" onClick={clearAll}>
                Clear filters
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-10 text-center">
              <p className="text-sm font-medium">No runs yet</p>
              <p className="mt-1 text-xs text-muted-foreground">Runs you start from the Playground or the API appear here.</p>
              <Button asChild className="mt-4" size="sm">
                <Link to="/new">Open the Playground</Link>
              </Button>
            </div>
          )
        ) : (
          <>
            <div className={list.isPlaceholderData ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
              <ExecutionsTable items={items} />
            </div>
            <nav aria-label="Pagination" className="mt-4 flex items-center justify-between">
              <p className="text-xs text-muted-foreground" data-testid="runs-count">
                Page {pageNumber} · {items.length} run{items.length === 1 ? '' : 's'}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={cursors.length === 1} onClick={() => setCursors((c) => c.slice(0, -1))}>
                  <ChevronLeft aria-hidden /> Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!list.data?.nextCursor}
                  onClick={() => list.data?.nextCursor && setCursors((c) => [...c, list.data!.nextCursor!])}
                >
                  Next <ChevronRight aria-hidden />
                </Button>
              </div>
            </nav>
          </>
        )}
      </section>
    </Page>
  );
}
