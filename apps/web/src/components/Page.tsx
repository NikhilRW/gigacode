import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Small "+" mark placed on section corners, as in the reference design. Decorative only. */
function Crosshair({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 11 11"
      className={cn('absolute hidden size-[11px] text-muted-foreground/60 lg:block', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
    >
      <path d="M5.5 0v11M0 5.5h11" />
    </svg>
  );
}

/**
 * Page frame: a bordered column whose sections are separated by hairlines.
 * Use <PageHeader/> first, then <Section/> blocks.
 */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('relative border-x border-dashed lg:border-border', className)}>{children}</div>;
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-6 px-4 pb-10 pt-4 sm:flex-row sm:items-end sm:justify-between lg:px-10 lg:pt-8">
      <div className="max-w-xl">
        <h1 className="text-balance text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Two-tone headline: the first line in the foreground colour, the second muted. */
export function TwoTone({ first, second }: { first: ReactNode; second: ReactNode }) {
  return (
    <>
      <span className="block">{first}</span>
      <span className="block text-muted-foreground">{second}</span>
    </>
  );
}

/** A hairline-separated block: title and one-line explanation on the left, content on the right. */
export function Section({
  title,
  description,
  children,
  actions,
  id,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className="relative border-t px-4 py-8 lg:px-10">
      <Crosshair className="-left-[6px] -top-[6px]" />
      <Crosshair className="-right-[6px] -top-[6px]" />
      <div className="grid gap-6 md:grid-cols-[minmax(0,14rem)_1fr] md:gap-10 lg:grid-cols-[minmax(0,16rem)_1fr]">
        <div>
          <h2 id={id ? `${id}-title` : undefined} className="text-sm font-medium">
            {title}
          </h2>
          {description && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{description}</p>}
          {actions && <div className="mt-4">{actions}</div>}
        </div>
        <div className="min-w-0">{children}</div>
      </div>
    </section>
  );
}
