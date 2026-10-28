import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Loader2, Plus, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import type { ApiKey, CreatedApiKey } from '@engine/shared';
import { api } from '@/api/endpoints';
import { describeError } from '@/api/client';
import { CodeSnippets } from '@/components/CodeSnippets';
import { CopyButton } from '@/components/CopyButton';
import { Page, PageHeader, Section } from '@/components/Page';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Create-key dialog. After creation it switches to a reveal-once view with the key and usage snippets. */
function CreateKeyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [created, setCreated] = useState<CreatedApiKey | null>(null);

  const create = useMutation({
    mutationFn: api.createApiKey,
    onSuccess: (k) => {
      setCreated(k);
      void qc.invalidateQueries({ queryKey: ['api-keys'] });
      void qc.invalidateQueries({ queryKey: ['onboarding'] });
    },
  });

  const reset = () => {
    setName('');
    setCreated(null);
    create.reset();
  };
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) reset();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(name.trim());
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className={cn(created ? 'sm:max-w-2xl' : 'sm:max-w-md')}>
        {created ? (
          <div className="min-w-0 space-y-5">
            <DialogHeader>
              <DialogTitle>Key created: {created.name}</DialogTitle>
              <DialogDescription>Use it as a bearer token to call the API.</DialogDescription>
            </DialogHeader>
            <Alert variant="warning">
              <ShieldAlert aria-hidden />
              <div>
                <AlertTitle>Copy this key now</AlertTitle>
                <AlertDescription>It is shown only once. We store only a hash, so it cannot be shown again. If you lose it, revoke it and create a new one.</AlertDescription>
              </div>
            </Alert>
            <div className="flex items-center gap-2 rounded-md border bg-muted/50 p-2 pl-3">
              <code data-testid="new-api-key" className="min-w-0 flex-1 select-all break-all font-mono text-xs">
                {created.key}
              </code>
              <CopyButton text={created.key} label="Copy key" variant="outline" size="sm" className="shrink-0" />
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">Try it</p>
              <CodeSnippets origin={window.location.origin} apiKey={created.key} />
            </div>
            <DialogFooter>
              <Button onClick={() => close(false)}>I&apos;ve saved the key</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <DialogHeader>
              <DialogTitle>Create API key</DialogTitle>
              <DialogDescription>Give it a name that tells you where it is used, for example &quot;ci-pipeline&quot;.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="key-name">Name</Label>
              <Input id="key-name" required autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="ci-pipeline" />
            </div>
            {create.error && (
              <p role="alert" className="text-sm text-destructive">
                {describeError(create.error)}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending || !name.trim()}>
                {create.isPending && <Loader2 className="animate-spin" aria-hidden />}
                Create key
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function KeyRow({ k, onRevoke }: { k: ApiKey; onRevoke: (k: ApiKey) => void }) {
  const revoked = !!k.revokedAt;
  return (
    <TableRow className={cn(revoked && 'text-muted-foreground')} data-testid="api-key-row">
      <TableCell className="font-medium">{k.name}</TableCell>
      <TableCell className="font-mono text-xs">ce_live_{k.prefix}…</TableCell>
      <TableCell className="text-xs">{formatRelative(k.createdAt)}</TableCell>
      <TableCell className="text-xs">{formatRelative(k.lastUsedAt)}</TableCell>
      <TableCell>
        {revoked ? <Badge variant="secondary">Revoked</Badge> : <Badge className="border-success/30 bg-success/10 text-success hover:bg-success/10" variant="outline">Active</Badge>}
      </TableCell>
      <TableCell className="text-right">
        {!revoked && (
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => onRevoke(k)}>
            Revoke
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

export function ApiKeysPage() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);

  const keys = useQuery({ queryKey: ['api-keys'], queryFn: api.listApiKeys });
  const revoke = useMutation({
    mutationFn: api.revokeApiKey,
    onSuccess: () => {
      toast.success('Key revoked. It can no longer be used.');
      setRevoking(null);
      void qc.invalidateQueries({ queryKey: ['api-keys'] });
    },
    onError: (err) => {
      toast.error(describeError(err));
      setRevoking(null);
    },
  });

  const items = keys.data?.items ?? [];

  return (
    <Page>
      <PageHeader
        title="API keys"
        subtitle="Keys let scripts, CI and other services submit code without a browser session. Each key belongs to this workspace."
        actions={
          <Button size="lg" onClick={() => setCreating(true)}>
            <Plus aria-hidden /> Create key
          </Button>
        }
      />

      <Section id="keys" title="Your keys" description="Revoke a key the moment you suspect it leaked. Revoking takes effect immediately.">
        {keys.isPending ? (
          <Skeleton className="h-28 w-full" />
        ) : keys.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {describeError(keys.error)}{' '}
            <Button variant="link" className="h-auto p-0" onClick={() => void keys.refetch()}>
              Try again
            </Button>
          </p>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <KeyRound className="mx-auto size-6 text-muted-foreground" aria-hidden />
            <p className="mt-3 text-sm font-medium">No API keys yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Create one to call the API from your terminal or code.</p>
            <Button className="mt-4" size="sm" onClick={() => setCreating(true)}>
              Create your first key
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((k) => (
                  <KeyRow key={k.id} k={k} onRevoke={setRevoking} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      <Section id="usage" title="Use the API" description="Replace $KEY with a key from above. Examples call this server.">
        <CodeSnippets origin={window.location.origin} apiKey="$KEY" />
        <p className="mt-4 text-xs text-muted-foreground">
          Add an <code className="font-mono">Idempotency-Key</code> header to make retries safe. Full reference:{' '}
          <a className="underline underline-offset-4" href="/docs" target="_blank" rel="noreferrer">
            API reference
          </a>
          .
        </p>
      </Section>

      <CreateKeyDialog open={creating} onOpenChange={setCreating} />

      <AlertDialog open={revoking !== null} onOpenChange={(o) => !o && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke &quot;{revoking?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              Anything using this key will start getting &quot;invalid API key&quot; errors straight away. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep key</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                if (revoking) revoke.mutate(revoking.id);
              }}
            >
              {revoke.isPending && <Loader2 className="animate-spin" aria-hidden />}
              Revoke key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}
