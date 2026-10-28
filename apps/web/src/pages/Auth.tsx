import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, Loader2, ShieldCheck, Terminal, Timer, Zap } from 'lucide-react';
import type { Me } from '@engine/shared';
import { api } from '@/api/endpoints';
import { describeError } from '@/api/client';
import { ThemeToggle } from '@/components/Layout';
import { TwoTone } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const POINTS = [
  { icon: ShieldCheck, text: 'Layered isolation: namespaces, seccomp and resource limits around every run.' },
  { icon: Timer, text: 'Strict time and memory limits, with clear explanations when a run hits them.' },
  { icon: Zap, text: 'Python, Node.js, C and C++, from the browser or a single API call.' },
];

function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="hidden flex-col justify-between border-r bg-sidebar p-12 lg:flex">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Terminal className="size-4" aria-hidden />
          </span>
          <span className="text-sm font-semibold">GigaCode</span>
        </div>
        <div>
          <p className="text-4xl font-semibold leading-tight tracking-tight">
            <TwoTone first="Run code," second="safely contained." />
          </p>
          <ul className="mt-10 space-y-5">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex gap-3 text-sm text-muted-foreground">
                <Icon className="mt-0.5 size-4 shrink-0 text-foreground" aria-hidden />
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-muted-foreground">Linux sandboxing is defence in depth, not a guarantee.</p>
      </aside>
      <div className="relative flex items-center justify-center px-4 py-12">
        <div className="absolute right-4 top-4">
          <ThemeToggle />
        </div>
        <main className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Terminal className="size-4" aria-hidden />
            </span>
            <span className="text-sm font-semibold">GigaCode</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
          <div className="mt-8">{children}</div>
          <p className="mt-6 text-sm text-muted-foreground">{footer}</p>
        </main>
      </div>
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

function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {describeError(error)}
    </p>
  );
}

function PasswordInput({ id, label, hint, autoComplete, value, onChange, minLength }: {
  id: string;
  label: string;
  hint?: string;
  autoComplete: string;
  value: string;
  onChange: (v: string) => void;
  minLength?: number;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          required
          minLength={minLength}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pr-10"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-0 top-0 size-9 text-muted-foreground"
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </Button>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
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
    <AuthShell
      title="Sign in"
      subtitle="Welcome back. Enter your details to continue."
      footer={
        <>
          No account?{' '}
          <Link className="font-medium text-foreground underline underline-offset-4" to="/register">
            Create one
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <PasswordInput id="password" label="Password" autoComplete="current-password" value={password} onChange={setPassword} />
        <FormError error={login.error} />
        <Button type="submit" size="lg" className="w-full" disabled={login.isPending}>
          {login.isPending && <Loader2 className="animate-spin" aria-hidden />}
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthShell>
  );
}

export function RegisterPage() {
  const [name, setName] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const onSuccess = useAuthSuccess();
  const register = useMutation({ mutationFn: api.register, onSuccess });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    register.mutate({ name: name.trim() || undefined, tenantName, email, password });
  };
  return (
    <AuthShell
      title="Create your workspace"
      subtitle="Free to start. You can run your first program in under a minute."
      footer={
        <>
          Already have an account?{' '}
          <Link className="font-medium text-foreground underline underline-offset-4" to="/login">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="name">Your name</Label>
          <Input id="name" autoComplete="name" autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="workspace">Workspace name</Label>
          <Input id="workspace" required minLength={2} maxLength={80} value={tenantName} onChange={(e) => setTenantName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <PasswordInput
          id="password"
          label="Password"
          hint="At least 10 characters."
          autoComplete="new-password"
          minLength={10}
          value={password}
          onChange={setPassword}
        />
        <FormError error={register.error} />
        <Button type="submit" size="lg" className="w-full" disabled={register.isPending}>
          {register.isPending && <Loader2 className="animate-spin" aria-hidden />}
          {register.isPending ? 'Creating…' : 'Create account'}
        </Button>
      </form>
    </AuthShell>
  );
}
