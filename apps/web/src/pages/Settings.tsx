import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Loader2, LogOut, Moon, Sun } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, describeError } from '@/api/client';
import { api } from '@/api/endpoints';
import { useRequiredMe } from '@/auth';
import { Page, PageHeader, Section } from '@/components/Page';
import { PasswordInput } from '@/components/PasswordInput';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { formatBytes, formatMs } from '@/lib/format';
import { applyTheme, currentTheme, type Theme } from '@/lib/theme';

function ProfileSection() {
  const me = useRequiredMe();
  const qc = useQueryClient();
  const [name, setName] = useState(me.user.name ?? '');
  const trimmed = name.trim();
  const changed = trimmed !== (me.user.name ?? '');

  const save = useMutation({
    mutationFn: api.updateProfile,
    onSuccess: (updated) => {
      qc.setQueryData(['me'], updated);
      toast.success('Profile updated.');
    },
    onError: (err) => toast.error(describeError(err)),
  });

  return (
    <Section id="profile" title="Profile" description="Your name is used in greetings. Email and workspace are fixed for now.">
      <form
        className="max-w-md space-y-5"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (changed && trimmed) save.mutate({ name: trimmed });
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="profile-name">Name</Label>
          <Input id="profile-name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="profile-email">Email</Label>
          <Input id="profile-email" value={me.user.email} disabled readOnly />
        </div>
        <div className="space-y-2">
          <Label htmlFor="profile-workspace">Workspace</Label>
          <Input id="profile-workspace" value={me.tenant.name} disabled readOnly />
        </div>
        <Button type="submit" disabled={!changed || !trimmed || save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" aria-hidden />}
          Save changes
        </Button>
      </form>
    </Section>
  );
}

function PasswordSection() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [currentError, setCurrentError] = useState<string | null>(null);

  const mismatch = confirm.length > 0 && next !== confirm ? 'The two new passwords do not match.' : null;
  const same = next.length > 0 && next === current ? 'Choose a password different from the current one.' : null;
  const valid = current.length > 0 && next.length >= 10 && next === confirm && next !== current;

  const change = useMutation({
    mutationFn: api.changePassword,
    onSuccess: () => {
      toast.success('Password changed.');
      setCurrent('');
      setNext('');
      setConfirm('');
      setCurrentError(null);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'wrong_password') setCurrentError('That is not your current password.');
      else toast.error(describeError(err));
    },
  });

  return (
    <Section id="password" title="Password" description="Use at least 10 characters. You stay signed in on this device after changing it.">
      <form
        className="max-w-md space-y-5"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (valid) change.mutate({ currentPassword: current, newPassword: next });
        }}
      >
        <PasswordInput
          id="current-password"
          label="Current password"
          autoComplete="current-password"
          value={current}
          error={currentError}
          onChange={(v) => {
            setCurrent(v);
            setCurrentError(null);
          }}
        />
        <PasswordInput id="new-password" label="New password" hint="At least 10 characters." autoComplete="new-password" minLength={10} value={next} error={same} onChange={setNext} />
        <PasswordInput id="confirm-password" label="Confirm new password" autoComplete="new-password" value={confirm} error={mismatch} onChange={setConfirm} />
        <Button type="submit" disabled={!valid || change.isPending}>
          {change.isPending && <Loader2 className="animate-spin" aria-hidden />}
          Change password
        </Button>
      </form>
    </Section>
  );
}

function AppearanceSection() {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  return (
    <Section id="appearance" title="Appearance" description="Light is the default. Your choice is remembered on this device.">
      <ToggleGroup
        type="single"
        variant="outline"
        value={theme}
        aria-label="Theme"
        onValueChange={(v) => {
          if (v === 'light' || v === 'dark') {
            applyTheme(v);
            setTheme(v);
          }
        }}
      >
        <ToggleGroupItem value="light" className="gap-2 px-4">
          <Sun className="size-4" aria-hidden /> Light
        </ToggleGroupItem>
        <ToggleGroupItem value="dark" className="gap-2 px-4">
          <Moon className="size-4" aria-hidden /> Dark
        </ToggleGroupItem>
      </ToggleGroup>
    </Section>
  );
}

function LimitsSection() {
  const me = useRequiredMe();
  const usage = useQuery({ queryKey: ['usage'], queryFn: api.usage, refetchInterval: 10_000 });
  const l = me.limits;
  const running = usage.data?.running ?? 0;
  return (
    <Section id="limits" title="Workspace limits" description="Caps for every run in this workspace. A platform admin can change them.">
      <div className="max-w-md space-y-6">
        <div>
          <div className="mb-1.5 flex justify-between text-sm">
            <span>Runs at the same time</span>
            <span className="tabular-nums text-muted-foreground">
              {usage.data ? `${running} of ${l.maxConcurrent} in use` : `up to ${l.maxConcurrent}`}
            </span>
          </div>
          <Progress value={l.maxConcurrent > 0 ? Math.min(100, (running / l.maxConcurrent) * 100) : 0} aria-label="Concurrent runs in use" className="h-1.5" />
        </div>
        <dl className="divide-y rounded-lg border bg-card text-sm">
          {[
            ['Runs per minute', String(l.maxExecPerMin)],
            ['Longest run', formatMs(l.maxTimeoutMs)],
            ['Memory per run', `${l.maxMemoryMb} MB`],
            ['Source size per run', formatBytes(l.maxSourceBytes)],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center justify-between px-4 py-3">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-medium tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Section>
  );
}

function SessionSection() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const signOut = useMutation({
    mutationFn: api.logout,
    onSettled: () => {
      qc.clear();
      navigate('/login');
    },
  });
  return (
    <Section id="session" title="Session" description="Sign out of this browser.">
      <Button variant="outline" onClick={() => signOut.mutate()} disabled={signOut.isPending}>
        {signOut.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <LogOut aria-hidden />}
        Sign out
      </Button>
    </Section>
  );
}

export function SettingsPage() {
  return (
    <Page>
      <PageHeader title="Settings" subtitle="Your profile, password and preferences." />
      <ProfileSection />
      <PasswordSection />
      <AppearanceSection />
      <LimitsSection />
      <SessionSection />
    </Page>
  );
}
