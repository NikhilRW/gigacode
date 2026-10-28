import type { ExecutionStatus } from '@engine/shared';
import { isTerminal } from '@shared/states.ts';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PROGRESS_STEPS, STATUS_TONE, progressIndex } from '@/lib/runStatus';

/** Four-step live progress: Queued → Starting → Running → Done. */
export function RunProgress({ status, attempt }: { status: ExecutionStatus; attempt: number }) {
  const current = progressIndex(status);
  const finished = isTerminal(status);
  const bad = finished && STATUS_TONE[status] !== 'success' && status !== 'CANCELLED';
  const retrying = !finished && attempt > 1 && status === 'QUEUED';

  return (
    <div data-testid="run-progress" data-step={PROGRESS_STEPS[current]} className="w-full">
      <ol className="flex items-center" aria-label="Run progress">
        {PROGRESS_STEPS.map((label, i) => {
          const done = i < current || (i === current && finished && !bad);
          const active = i === current && !finished;
          const failedStep = i === current && bad;
          return (
            <li key={label} className={cn('flex items-center', i < PROGRESS_STEPS.length - 1 && 'flex-1')} aria-current={active ? 'step' : undefined}>
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    'grid size-6 shrink-0 place-items-center rounded-full border text-[11px] font-medium transition-colors',
                    done && 'border-success bg-success text-success-foreground',
                    active && 'border-primary bg-primary text-primary-foreground',
                    failedStep && 'border-destructive bg-destructive text-destructive-foreground',
                    !done && !active && !failedStep && 'border-border text-muted-foreground',
                  )}
                >
                  {done ? <Check className="size-3.5" aria-hidden /> : failedStep ? <X className="size-3.5" aria-hidden /> : i + 1}
                </span>
                <span className={cn('text-xs', active || failedStep ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                  {label}
                </span>
              </span>
              {i < PROGRESS_STEPS.length - 1 && (
                <span aria-hidden className={cn('mx-3 h-px flex-1 transition-colors', i < current ? 'bg-success' : 'bg-border')} />
              )}
            </li>
          );
        })}
      </ol>
      {retrying && (
        <p className="mt-2 text-xs text-muted-foreground" role="status">
          A worker was lost, so this run was queued again (attempt {attempt}).
        </p>
      )}
    </div>
  );
}
