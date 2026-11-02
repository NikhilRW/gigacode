import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Info, Loader2, Play, RotateCw, Square } from 'lucide-react';
import { toast } from 'sonner';
import { LANGUAGES } from '@shared/languages.ts';
import { isTerminal } from '@shared/states.ts';
import type { ExecutionAttempt } from '@engine/shared';
import { api } from '@/api/endpoints';
import { ApiError, describeError } from '@/api/client';
import { CopyButton } from '@/components/CopyButton';
import { Timeline } from '@/components/ExecutionResult';
import { Page, PageHeader, Section } from '@/components/Page';
import { LogsPanel, MetricChips, OutcomeNotice } from '@/components/RunOutput';
import { RunProgress } from '@/components/RunProgress';
import { StatusChip } from '@/components/StatusChip';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatBytes, formatMs, formatRelative, shortId } from '@/lib/format';
import { STATUS_LABEL } from '@/lib/runStatus';
import { useLiveExecution } from '@/lib/useLiveExecution';

function attemptOutcome(a: ExecutionAttempt): string {
  if (!a.outcome) return a.finishedAt ? 'Ended' : 'In progress';
  if (a.outcome === 'lease_expired') return 'Worker lost; retried';
  return STATUS_LABEL[a.outcome as keyof typeof STATUS_LABEL] ?? a.outcome;
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b py-2.5 text-sm last:border-0">
      <dt className="shrink-0 whitespace-nowrap text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

function SourceTab({ id }: { id: string }) {
  const source = useQuery({ queryKey: ['source', id], queryFn: () => api.getSource(id), staleTime: Infinity });
  if (source.isPending) return <Skeleton className="h-40 w-full" />;
  if (source.isError) return <p role="alert" className="text-sm text-destructive">{describeError(source.error)}</p>;
  const s = source.data;
  return (
    <div className="space-y-4">
      <Tabs defaultValue={s.files.some((f) => f.path === s.entryFile) ? s.entryFile : s.files[0]?.path}>
        <TabsList className="h-auto flex-wrap justify-start">
          {s.files.map((f) => (
            <TabsTrigger key={f.path} value={f.path} className="font-mono text-xs">
              {f.path}
              {f.path === s.entryFile && s.files.length > 1 ? ' (entry)' : ''}
            </TabsTrigger>
          ))}
        </TabsList>
        {s.files.map((f) => (
          <TabsContent key={f.path} value={f.path} className="mt-3">
            <pre tabIndex={0} aria-label={`Source of ${f.path}`} className="max-h-96 overflow-auto rounded-md border bg-muted/50 p-3 font-mono text-xs leading-relaxed">
              {f.content || '(empty file)'}
            </pre>
          </TabsContent>
        ))}
      </Tabs>
      {s.stdin && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Standard input</p>
          <pre tabIndex={0} aria-label="Standard input" className="max-h-40 overflow-auto rounded-md border bg-muted/50 p-3 font-mono text-xs">
            {s.stdin}
          </pre>
        </div>
      )}
    </div>
  );
}

export function ExecutionDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const live = useLiveExecution(id);
  const e = live.data;
  const [confirmCancel, setConfirmCancel] = useState(false);

  const cancel = useMutation({
    mutationFn: () => api.cancelExecution(id),
    onSuccess: () => {
      toast.success('Cancelling…');
      void qc.invalidateQueries({ queryKey: ['execution', id] });
    },
    onError: (err) => toast.error(describeError(err)),
  });
  const rerun = useMutation({
    mutationFn: async () => {
      const src = await api.getSource(id);
      return api.createExecution({
        language: src.language,
        files: src.files,
        entryFile: src.entryFile,
        stdin: src.stdin,
        network: src.network === true,
        limits: src.limits,
      });
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['onboarding'] });
      navigate(`/executions/${r.id}`);
    },
    onError: (err) => toast.error(describeError(err)),
  });
  const openInPlayground = useMutation({
    mutationFn: () => api.getSource(id),
    onSuccess: (source) => navigate('/new', { state: { source } }),
    onError: (err) => toast.error(describeError(err)),
  });

  if (live.isPending) {
    return (
      <Page>
        <div className="space-y-4 p-10">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-48 w-full" />
        </div>
      </Page>
    );
  }
  if (!e) {
    const notFound = live.error instanceof ApiError && live.error.status === 404;
    return (
      <Page>
        <div className="px-4 py-16 text-center lg:px-10">
          <p className="text-lg font-semibold">{notFound ? 'Run not found' : 'Could not load this run'}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {notFound ? 'It may belong to another workspace, or it may have been deleted.' : describeError(live.error)}
          </p>
          <Button asChild className="mt-6">
            <Link to="/executions">Back to runs</Link>
          </Button>
        </div>
      </Page>
    );
  }

  const active = !isTerminal(e.status);
  const lang = LANGUAGES[e.language]?.label ?? e.language;
  const retried = e.attempts.length > 1;

  return (
    <Page>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span>Run {shortId(e.id)}</span>
            <StatusChip status={e.status} className="text-sm" />
          </span>
        }
        subtitle={
          <>
            <Link to="/executions" className="mb-2 inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline">
              <ArrowLeft className="size-3.5" aria-hidden /> All runs
            </Link>
            <span className="block">
              {lang} · started {formatRelative(e.createdAt)}
            </span>
          </>
        }
        actions={
          <>
            {active && (
              <Button variant="outline" onClick={() => setConfirmCancel(true)} disabled={cancel.isPending || e.cancelRequested}>
                {e.cancelRequested ? <Loader2 className="animate-spin" aria-hidden /> : <Square aria-hidden />}
                {e.cancelRequested ? 'Cancelling…' : 'Cancel run'}
              </Button>
            )}
            <Button variant="outline" onClick={() => openInPlayground.mutate()} disabled={openInPlayground.isPending}>
              <Play aria-hidden /> Open in Playground
            </Button>
            <Button onClick={() => rerun.mutate()} disabled={rerun.isPending}>
              {rerun.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <RotateCw aria-hidden />}
              Re-run
            </Button>
          </>
        }
      />

      <Section id="result" title="Result" description="How this run ended and what it printed.">
        <div className="space-y-5">
          <RunProgress status={e.status} attempt={e.attempt} />
          {!active && <OutcomeNotice e={e} />}
          {!active && <MetricChips e={e} />}

          <Tabs defaultValue="output">
            <TabsList>
              <TabsTrigger value="output">Output</TabsTrigger>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
              <TabsTrigger value="attempts">
                Attempts{retried ? ` (${e.attempts.length})` : ''}
              </TabsTrigger>
              <TabsTrigger value="source">Source</TabsTrigger>
            </TabsList>

            <TabsContent value="output" className="mt-4">
              <LogsPanel e={e} />
            </TabsContent>

            <TabsContent value="timeline" className="mt-4">
              <Timeline events={e.events} />
            </TabsContent>

            <TabsContent value="attempts" className="mt-4 space-y-4">
              {retried && (
                <Alert>
                  <Info aria-hidden />
                  <div>
                    <AlertTitle>Retried automatically</AlertTitle>
                    <AlertDescription>
                      A worker was lost before this run finished, so the platform started it again on another worker. Only the last attempt&apos;s result counts.
                    </AlertDescription>
                  </div>
                </Alert>
              )}
              <div className="overflow-x-auto rounded-lg border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Attempt</TableHead>
                      <TableHead>Worker</TableHead>
                      <TableHead>Started</TableHead>
                      <TableHead>Result</TableHead>
                      <TableHead className="text-right">Exit code</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {e.attempts.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                          Waiting for a worker to pick this run up.
                        </TableCell>
                      </TableRow>
                    ) : (
                      e.attempts.map((a) => (
                        <TableRow key={a.attempt}>
                          <TableCell className="tabular-nums">{a.attempt}</TableCell>
                          <TableCell className="font-mono text-xs">{a.workerId}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{new Date(a.startedAt).toLocaleTimeString()}</TableCell>
                          <TableCell className="text-sm">{attemptOutcome(a)}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{a.exitCode ?? '—'}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            <TabsContent value="source" className="mt-4">
              <SourceTab id={e.id} />
            </TabsContent>
          </Tabs>
        </div>
      </Section>

      <Section id="details" title="Details" description="Settings and timing for this run.">
        <dl className="grid gap-x-10 md:grid-cols-2">
          <div>
            <Detail label="Run ID">
              <span className="inline-flex items-center gap-1">
                <code className="break-all font-mono text-[11px]">{e.id}</code>
                <CopyButton text={e.id} label="Copy" />
              </span>
            </Detail>
            <Detail label="Language">{lang}</Detail>
            <Detail label="Entry file">
              <code className="font-mono text-xs">{e.entryFile}</code>
            </Detail>
            <Detail label="Attempts">
              {e.attempt} of {e.maxAttempts} allowed
            </Detail>
          </div>
          <div>
            <Detail label="Created">{new Date(e.createdAt).toLocaleString()}</Detail>
            <Detail label="Finished">{e.finishedAt ? new Date(e.finishedAt).toLocaleString() : '—'}</Detail>
            <Detail label="Time limit">{formatMs(e.limits.timeoutMs)}</Detail>
            <Detail label="Memory limit">{formatBytes(e.limits.memoryMb * 1024 * 1024)}</Detail>
          </div>
        </dl>
      </Section>

      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this run?</AlertDialogTitle>
            <AlertDialogDescription>
              The program is stopped where it is. Output printed so far may be lost. This cannot be undone, but you can run it again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep running</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => cancel.mutate()}
            >
              Cancel run
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}
