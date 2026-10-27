import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/endpoints.ts';
import { useRequiredMe } from '../auth.tsx';
import { applyTheme, currentTheme, type Theme } from '../lib/theme.ts';
import { Button } from './ui.tsx';

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <Button
      variant="ghost"
      aria-label={`Switch to ${next} mode`}
      onClick={() => {
        applyTheme(next);
        setTheme(next);
      }}
    >
      {theme === 'dark' ? '☀ Light' : '☾ Dark'}
    </Button>
  );
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-2.5 py-1.5 text-sm font-medium ${
    isActive
      ? 'bg-slate-200 text-slate-900 dark:bg-slate-800 dark:text-white'
      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
  }`;

export function Layout() {
  const me = useRequiredMe();
  const qc = useQueryClient();
  const navigate = useNavigate();

  async function logout() {
    try {
      await api.logout();
    } finally {
      qc.clear();
      navigate('/login');
    }
  }

  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 dark:focus:bg-slate-900">
        Skip to content
      </a>
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-2">
          <span className="mr-2 font-semibold">⧉ Exec Engine</span>
          <nav aria-label="Main" className="flex flex-wrap gap-1">
            <NavLink to="/" end className={linkClass}>Dashboard</NavLink>
            <NavLink to="/new" className={linkClass}>New execution</NavLink>
            <NavLink to="/executions" className={linkClass}>Executions</NavLink>
            <NavLink to="/api-keys" className={linkClass}>API keys</NavLink>
            {me.user.role === 'platform_admin' && <NavLink to="/admin" className={linkClass}>Admin</NavLink>}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-xs text-slate-500 sm:inline">
              {me.tenant.name} · {me.user.email}
            </span>
            <ThemeToggle />
            <Button variant="secondary" onClick={logout}>Sign out</Button>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
