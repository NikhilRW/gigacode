import type { ExecutionStatus } from '@engine/shared';
import { cn } from '@/lib/utils';
import { STATUS_LABEL, STATUS_TONE, type Tone } from '@/lib/runStatus';

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'border-border bg-muted text-muted-foreground',
  info: 'border-primary/20 bg-primary/10 text-foreground',
  success: 'border-success/30 bg-success/10 text-success',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  danger: 'border-destructive/30 bg-destructive/10 text-destructive',
};

const DOT_CLASS: Record<Tone, string> = {
  neutral: 'bg-muted-foreground/60',
  info: 'bg-primary animate-pulse',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
};

/** Status badge. The raw enum stays in data-status for tests and tooling; people see a plain label. */
export function StatusChip({ status, className }: { status: ExecutionStatus; className?: string }) {
  const tone = STATUS_TONE[status];
  return (
    <span
      data-testid="status-chip"
      data-status={status}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        TONE_CLASS[tone],
        className,
      )}
    >
      <span aria-hidden className={cn('size-1.5 rounded-full', DOT_CLASS[tone])} />
      {STATUS_LABEL[status]}
    </span>
  );
}
