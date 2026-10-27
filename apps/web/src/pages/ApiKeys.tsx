import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreatedApiKey } from '@engine/shared';
import { api } from '../api/endpoints.ts';
import { Button, Card, ErrorNotice, Field, Input, Table, td } from '../components/ui.tsx';
import { formatTime } from '../lib/format.ts';

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <Button
      variant="secondary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState('copied');
        } catch {
          setState('failed');
        }
        setTimeout(() => setState('idle'), 2000);
      }}
    >
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed — select manually' : label}
    </Button>
  );
}

export function ApiKeysPage() {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const keys = useQuery({ queryKey: ['api-keys'], queryFn: api.listApiKeys });
  const create = useMutation({
    mutationFn: api.createApiKey,
    onSuccess: (k) => {
      setCreated(k);
      setName('');
      void qc.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });
  const revoke = useMutation({
    mutationFn: api.revokeApiKey,
    onSuccess: () => {
      setConfirming(null);
      void qc.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(name.trim());
  };

  const origin = window.location.origin;
  const curl = `curl -X POST ${origin}/v1/executions \\
  -H "Authorization: Bearer ${created?.key ?? '<your api key>'}" \\
  -H "Content-Type: application/json" \\
  -d '{"language":"python","files":[{"path":"main.py","content":"print(\\"hi\\")"}],"entryFile":"main.py"}'

# then poll:
curl ${origin}/v1/executions/<id> -H "Authorization: Bearer <your api key>"`;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">API keys</h1>
      <Card title="Create a key">
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
          <div className="w-64">
            <Field label="Name">
              <Input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="ci-pipeline" />
            </Field>
          </div>
          <Button type="submit" disabled={create.isPending || !name.trim()}>Create</Button>
        </form>
        <div className="mt-3"><ErrorNotice error={create.error} /></div>
        {created && (
          <div role="status" className="mt-4 rounded-md border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950">
            <p className="mb-2 text-sm font-medium">Copy this key now. It will not be shown again.</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="break-all rounded bg-white px-2 py-1 font-mono text-xs dark:bg-slate-900" data-testid="new-api-key">{created.key}</code>
              <CopyButton text={created.key} />
              <Button variant="ghost" onClick={() => setCreated(null)}>Dismiss</Button>
            </div>
          </div>
        )}
      </Card>

      <Card title="Keys">
        <ErrorNotice error={keys.error ?? revoke.error} />
        {keys.data && keys.data.items.length === 0 && <p className="text-sm text-slate-500">No keys yet.</p>}
        {keys.data && keys.data.items.length > 0 && (
          <Table head={['Name', 'Prefix', 'Created', 'Last used', 'Status', '']}>
            {keys.data.items.map((k) => (
              <tr key={k.id}>
                <td className={td}>{k.name}</td>
                <td className={`${td} font-mono text-xs`}>{k.prefix}</td>
                <td className={td}>{formatTime(k.createdAt)}</td>
                <td className={td}>{formatTime(k.lastUsedAt)}</td>
                <td className={td}>{k.revokedAt ? 'Revoked' : 'Active'}</td>
                <td className={`${td} text-right`}>
                  {!k.revokedAt &&
                    (confirming === k.id ? (
                      <span className="inline-flex gap-1">
                        <Button variant="danger" onClick={() => revoke.mutate(k.id)} disabled={revoke.isPending}>Confirm revoke</Button>
                        <Button variant="ghost" onClick={() => setConfirming(null)}>Cancel</Button>
                      </span>
                    ) : (
                      <Button variant="secondary" onClick={() => setConfirming(k.id)}>Revoke</Button>
                    ))}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Example" actions={<CopyButton text={curl} label="Copy curl" />}>
        <pre className="overflow-x-auto rounded-md bg-slate-950 p-3 font-mono text-xs text-slate-100">{curl}</pre>
      </Card>
    </div>
  );
}
