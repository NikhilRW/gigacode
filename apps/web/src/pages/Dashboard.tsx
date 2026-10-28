import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Code2, Cpu, Inbox, Package } from 'lucide-react';
import { api } from '@/api/endpoints';
import { useRequiredMe } from '@/auth';
import { displayName } from '@/components/AppSidebar';
import { ExecutionsTable } from '@/components/ExecutionsTable';
import { Page, PageHeader, Section, TwoTone } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorNotice } from '@/components/ui';
import { formatBytes, formatMs, formatPercent } from '@/lib/format';
import { greeting } from '@/lib/greeting';
import { cn } from '@/lib/utils';

function FlowStep({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <span className="grid size-14 place-items-center rounded-2xl border bg-card shadow-sm">{icon}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function HowItWorks() {
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-4 rounded-2xl border bg-card/60 p-4 shadow-sm sm:gap-x-4"
      role="img"
      aria-label="Your code is queued, run in an isolated sandbox, and the result is stored"
    >
      <FlowStep icon={<Code2 className="size-6" aria-hidden />} label="Your code" />
      <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
      <FlowStep icon={<Inbox className="size-6" aria-hidden />} label="Queue" />
      <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
      <FlowStep icon={<Package className="size-6" aria-hidden />} label="Isolated sandbox" />
      <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
      <FlowStep icon={<Cpu className="size-6" aria-hidden />} label="Result" />
    </div>
  );
}

function Metric({ label, value, caption }: { label: string; value: ReactNode; caption?: string }) {
  return (
    <div className="px-0 sm:px-6 sm:first:pl-0 sm:[&:not(:first-child)]:border-l">
      <div className="text-3xl font-medium tabular-nums tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
      {caption && <div className="mt-0.5 text-[11px] text-muted-foreground/80">{caption}</div>}
    </div>
  );
}

function ActivityChart({ points }: { points: { at: string; success: number; failed: number; timeout: number; cancelled: number; other: number }[] }) {
  const totals = points.map((p) => p.success + p.failed + p.timeout + p.cancelled + p.other);
  const max = Math.max(1, ...totals);
  const total = totals.reduce((a, b) => a + b, 0);
  return (
    <figure className="mt-8">
      <figcaption className="mb-2 flex items-baseline justify-between text-xs text-muted-foreground">
        <span>Runs per hour, last {points.length} hours</span>
        <span className="tabular-nums">{total} total</span>
      </figcaption>
      <div className="flex h-16 items-end gap-[3px]" role="img" aria-label={`${total} runs in the last ${points.length} hours`}>
        {points.map((p, i) => {
          const t = totals[i] ?? 0;
          const failed = p.failed + p.timeout;
          const height = t === 0 ? 2 : Math.max(6, Math.round((t / max) * 64));
          return (
            <div
              key={p.at}
              title={`${new Date(p.at).toLocaleTimeString([], { hour: 'numeric' })}: ${t} run${t === 1 ? '' : 's'}${failed ? `, ${failed} failed` : ''}`}
              className={cn('flex-1 rounded-[2px]', t === 0 ? 'bg-border' : failed > 0 ? 'bg-warning/80' : 'bg-primary/80')}
              style={{ height }}
            />
          );
        })}
      </div>
    </figure>
  );
}

function UsageRow({ label, used, max }: { label: string; used: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-xs">
        <span>{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {used} / {max}
        </span>
      </div>
      <Progress value={pct} aria-label={label} className="h-1.5" />
    </div>
  );
}

interface Step {
  n: string;
  title: string;
  hint: string;
  to: string;
  done: boolean;
}

function SetupChecklist() {
  const onboarding = useQuery({ queryKey: ['onboarding'], queryFn: api.onboarding, refetchInterval: 5000 });
  const o = onboarding.data;
  const steps: Step[] = [
    { n: '01', title: 'Run your first program', hint: 'Open the Playground and press Run', to: '/new', done: !!o?.ranExecution },
    { n: '02', title: 'Create an API key', hint: 'Keys let scripts and CI submit code', to: '/api-keys', done: !!o?.createdApiKey },
    { n: '03', title: 'Call the API from your terminal', hint: 'Copy the curl example from API keys', to: '/api-keys', done: !!o?.usedApiKey },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  return (
    <Section
      id="setup"
      title="Get set up"
      description={o ? `${doneCount} of ${steps.length} steps complete.` : 'Three steps to your first API call.'}
    >
      {onboarding.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : (
        <ol className="divide-y border-y">
          {steps.map((s) => (
            <li key={s.n}>
              <Link
                to={s.to}
                className="group flex items-center gap-4 py-4 text-sm transition-colors hover:bg-accent/50 sm:px-2"
              >
                <span className="w-6 font-mono text-[11px] text-muted-foreground" aria-hidden>
                  {s.n}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn('block font-medium', s.done && 'text-muted-foreground line-through decoration-1')}>
                    {s.title}
                  </span>
                  <span className="block text-xs text-muted-foreground">{s.hint}</span>
                </span>
                {s.done ? (
                  <span className="flex items-center gap-1 text-xs font-medium text-success">
                    <Check className="size-4" aria-hidden /> Done
                  </span>
                ) : (
                  <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                )}
              </Link>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

export function DashboardPage() {
  const me = useRequiredMe();
  const usage = useQuery({ queryKey: ['usage'], queryFn: api.usage, refetchInterval: 5000 });
  const series = useQuery({ queryKey: ['usage', 'timeseries'], queryFn: () => api.timeseries(24), refetchInterval: 30_000 });
  const recent = useQuery({ queryKey: ['executions', 'recent'], queryFn: () => api.listExecutions({ limit: 8 }), refetchInterval: 5000 });
  const u = usage.data;

  return (
    <Page>
      <PageHeader
        title={<TwoTone first={`${greeting()}, ${displayName(me)}.`} second="Run code, safely contained." />}
        subtitle="Submit a program, and a sandboxed worker runs it with strict time and memory limits. Every run keeps its output, timing and history."
        actions={
          <Button asChild size="lg">
            <Link to="/new">
              New run <ArrowRight aria-hidden />
            </Link>
          </Button>
        }
      />

      <Section id="how" title="How a run works" description="Each program is queued, then executed in layered isolation with resource limits.">
        <HowItWorks />
      </Section>

      <Section id="activity" title="Activity" description="Live counts for this workspace.">
        <ErrorNotice error={usage.error} />
        <div className="grid grid-cols-2 gap-x-0 gap-y-6 sm:grid-cols-4">
          <Metric label="Running now" value={u ? u.running : <Skeleton className="h-9 w-10" />} />
          <Metric label="Queued" value={u ? u.queued : <Skeleton className="h-9 w-10" />} />
          <Metric label="Success rate (24h)" value={u ? formatPercent(u.successRate24h) : <Skeleton className="h-9 w-16" />} />
          <Metric
            label="Runs today"
            value={u ? u.executionsToday : <Skeleton className="h-9 w-10" />}
            caption={u ? `${formatMs(u.totalCpuMs)} CPU in total` : undefined}
          />
        </div>
        {series.data && <ActivityChart points={series.data.points} />}
      </Section>

      <SetupChecklist />

      <Section
        id="recent"
        title="Recent runs"
        description="Your latest runs, newest first."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/executions">View all runs</Link>
          </Button>
        }
      >
        <ErrorNotice error={recent.error} />
        {recent.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : recent.data && recent.data.items.length > 0 ? (
          <ExecutionsTable items={recent.data.items} />
        ) : (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <p className="text-sm font-medium">No runs yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Run your first program to see it here.</p>
            <Button asChild className="mt-4" size="sm">
              <Link to="/new">Open the Playground</Link>
            </Button>
          </div>
        )}
      </Section>

      {u && (
        <Section id="limits" title="Plan limits" description="Hard caps applied to this workspace. Ask an admin to change them.">
          <div className="grid gap-6 sm:grid-cols-2">
            <UsageRow label="Concurrent runs" used={u.running} max={u.limits.maxConcurrent} />
            <div className="text-xs">
              <div className="mb-1.5">Submission rate</div>
              <p className="text-muted-foreground">Up to {u.limits.maxExecPerMin} runs per minute</p>
            </div>
          </div>
          <p className="mt-6 text-xs text-muted-foreground">
            Up to {formatMs(u.limits.maxTimeoutMs)} per run · {u.limits.maxMemoryMb} MB memory · {formatBytes(u.limits.maxSourceBytes)} of source
          </p>
        </Section>
      )}
    </Page>
  );
}
