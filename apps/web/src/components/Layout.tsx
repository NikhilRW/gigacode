import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Moon, Sun } from 'lucide-react';
import { AppSidebar } from '@/components/AppSidebar';
import { Button } from '@/components/ui/button';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { applyTheme, currentTheme, type Theme } from '@/lib/theme';
import { cn } from '@/lib/utils';

/** Icon-only theme switch used on public screens (sign-in, register). */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Switch to ${next} mode`}
      onClick={() => {
        applyTheme(next);
        setTheme(next);
      }}
    >
      {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}

export function Layout() {
  // The Playground uses the full width for the editor; other pages keep a readable column.
  const wide = useLocation().pathname === '/new';
  return (
    <TooltipProvider delayDuration={200}>
      <SidebarProvider>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-card focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        <AppSidebar />
        <SidebarInset className="bg-background">
          <header className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b bg-background/90 px-4 backdrop-blur md:hidden">
            <SidebarTrigger aria-label="Open navigation" />
            <span className="text-sm font-semibold">GigaCode</span>
          </header>
          <main id="main" className={cn('mx-auto w-full flex-1 px-4 py-6 md:px-8 md:py-10', wide ? 'max-w-none md:py-6' : 'max-w-6xl')}>
            <Outlet />
          </main>
        </SidebarInset>
        <Toaster richColors closeButton />
      </SidebarProvider>
    </TooltipProvider>
  );
}
