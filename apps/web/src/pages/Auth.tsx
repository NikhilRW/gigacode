import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Me } from '@engine/shared';
import { api } from '../api/endpoints.ts';
import { ThemeToggle } from '../components/Layout.tsx';
import { Button, ErrorNotice, Field, Input } from '../components/ui.tsx';

function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="absolute right-4 top-4"><ThemeToggle /></div>
      <main className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h1 className="mb-1 text-xl font-semibold">{title}</h1>
        <p className="mb-5 text-sm text-slate-500">
          Run code with layered isolation and resource containment.
        </p>
        {children}
      </main>
    </div>
  );
}

function useAuthSuccess() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  return (me: Me) => {
    qc.setQueryData(['me'], me);
    const from = (location.state as { from?: string } | null)?.from;
    navigate(from && from !== '/login' ? from : '/', { replace: true });
  };
}

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const onSuccess = useAuthSuccess();
  const login = useMutation({ mutationFn: api.login, onSuccess });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({ email, password });
  };
  return (
    <AuthShell title="Sign in">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email">
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <ErrorNotice error={login.error} />
        <Button type="submit" className="w-full" disabled={login.isPending}>
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
      <p className="mt-4 text-sm text-slate-500">
        No account? <Link className="text-indigo-600 underline dark:text-indigo-400" to="/register">Create one</Link>
      </p>
    </AuthShell>
  );
}

export function RegisterPage() {
  const [tenantName, setTenantName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const onSuccess = useAuthSuccess();
  const register = useMutation({ mutationFn: api.register, onSuccess });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    register.mutate({ tenantName, email, password });
  };
  return (
    <AuthShell title="Create an account">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Organization name">
          <Input required minLength={2} maxLength={80} value={tenantName} onChange={(e) => setTenantName(e.target.value)} />
        </Field>
        <Field label="Email">
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" hint="At least 10 characters.">
          <Input type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <ErrorNotice error={register.error} />
        <Button type="submit" className="w-full" disabled={register.isPending}>
          {register.isPending ? 'Creating…' : 'Create account'}
        </Button>
      </form>
      <p className="mt-4 text-sm text-slate-500">
        Have an account? <Link className="text-indigo-600 underline dark:text-indigo-400" to="/login">Sign in</Link>
      </p>
    </AuthShell>
  );
}
