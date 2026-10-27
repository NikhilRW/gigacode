import type { ExecutionStatus } from '@engine/shared';

const COLORS: Record<ExecutionStatus, string> = {
  CREATED: 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100',
  QUEUED: 'bg-amber-100 text-amber-900 dark:bg-amber-900/60 dark:text-amber-100',
  DISPATCHED: 'bg-sky-100 text-sky-900 dark:bg-sky-900/60 dark:text-sky-100',
  STARTING: 'bg-cyan-100 text-cyan-900 dark:bg-cyan-900/60 dark:text-cyan-100',
  RUNNING: 'bg-indigo-100 text-indigo-900 dark:bg-indigo-900/60 dark:text-indigo-100',
  SUCCESS: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/60 dark:text-emerald-100',
  FAILED: 'bg-rose-100 text-rose-900 dark:bg-rose-900/60 dark:text-rose-100',
  TIMEOUT: 'bg-orange-100 text-orange-900 dark:bg-orange-900/60 dark:text-orange-100',
  CANCELLED: 'bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100',
  DEAD_LETTERED: 'bg-fuchsia-100 text-fuchsia-900 dark:bg-fuchsia-900/60 dark:text-fuchsia-100',
};

export function StatusChip({ status }: { status: ExecutionStatus }) {
  return (
    <span
      data-testid="status-chip"
      data-status={status}
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold tracking-wide ${COLORS[status]}`}
    >
      {status}
    </span>
  );
}
