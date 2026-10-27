import { useCallback, useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { LanguageId } from '@engine/shared';
import { HARD_LIMITS } from '@shared/constants.ts';
import { LANGUAGES, LANGUAGE_IDS } from '@shared/languages.ts';
import { isSafeRelativePath } from '@shared/paths.ts';
import { api } from '../api/endpoints.ts';
import { useRequiredMe } from '../auth.tsx';
import { CodeEditor } from '../components/CodeEditor.tsx';
import { ExecutionSummary } from '../components/ExecutionResult.tsx';
import { Button, Card, ErrorNotice, Field, Input, Select } from '../components/ui.tsx';
import { useLiveExecution } from '../lib/useLiveExecution.ts';

interface SourceFile {
  path: string;
  content: string;
}

function starter(lang: LanguageId): SourceFile[] {
  const cfg = LANGUAGES[lang];
  return [{ path: cfg.defaultEntryFile, content: cfg.helloWorld.replace('hello', 'hello, world') }];
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, Number.isFinite(v) ? v : min));

function FileTabs({
  files,
  active,
  onSelect,
  onAdd,
  onRename,
  onDelete,
}: {
  files: SourceFile[];
  active: number;
  onSelect: (i: number) => void;
  onAdd: (path: string) => string | null;
  onRename: (i: number, path: string) => string | null;
  onDelete: (i: number) => void;
}) {
  const [mode, setMode] = useState<null | { kind: 'add' } | { kind: 'rename'; index: number }>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const err = mode?.kind === 'add' ? onAdd(name.trim()) : mode ? onRename(mode.index, name.trim()) : null;
    if (err) setError(err);
    else {
      setMode(null);
      setError(null);
    }
  };

  return (
    <div className="rounded-t-md border border-slate-300 bg-slate-100 px-2 py-1 dark:border-slate-700 dark:bg-slate-800">
      <div role="tablist" aria-label="Files" className="flex flex-wrap items-center gap-1">
        {files.map((f, i) => (
          <button
            key={f.path}
            type="button"
            role="tab"
            aria-selected={i === active}
            onClick={() => onSelect(i)}
            onDoubleClick={() => {
              setMode({ kind: 'rename', index: i });
              setName(f.path);
            }}
            className={`rounded px-2 py-1 font-mono text-xs ${
              i === active ? 'bg-white shadow-sm dark:bg-slate-950' : 'text-slate-600 hover:bg-white/60 dark:text-slate-300 dark:hover:bg-slate-900'
            }`}
          >
            {f.path}
          </button>
        ))}
        <Button
          variant="ghost"
          className="!px-2 !py-1 text-xs"
          disabled={files.length >= HARD_LIMITS.maxFiles}
          onClick={() => {
            setMode({ kind: 'add' });
            setName('');
          }}
        >
          + File
        </Button>
        <Button
          variant="ghost"
          className="!px-2 !py-1 text-xs"
          onClick={() => {
            setMode({ kind: 'rename', index: active });
            setName(files[active]?.path ?? '');
          }}
        >
          Rename
        </Button>
        <Button variant="ghost" className="!px-2 !py-1 text-xs" disabled={files.length <= 1} onClick={() => onDelete(active)}>
          Delete
        </Button>
        <span className="ml-auto text-xs text-slate-500">{files.length}/{HARD_LIMITS.maxFiles} files</span>
      </div>
      {mode && (
        <form
          className="mt-1 flex flex-wrap items-center gap-2 pb-1"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label className="text-xs" htmlFor="file-name">{mode.kind === 'add' ? 'New file name' : 'Rename to'}</label>
          <Input id="file-name" autoFocus className="!w-56 font-mono text-xs" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setMode(null)} />
          <Button type="submit" className="!py-1 text-xs">Save</Button>
          <Button variant="ghost" className="!py-1 text-xs" onClick={() => setMode(null)}>Cancel</Button>
          {error && <span role="alert" className="text-xs text-rose-600">{error}</span>}
        </form>
      )}
    </div>
  );
}

export function NewExecutionPage() {
  const me = useRequiredMe();
  const maxTimeout = Math.min(me.limits.maxTimeoutMs, HARD_LIMITS.timeoutMs);
  const maxMemory = Math.min(me.limits.maxMemoryMb, HARD_LIMITS.memoryMb);

  const [language, setLanguage] = useState<LanguageId>('python');
  const [files, setFiles] = useState<SourceFile[]>(() => starter('python'));
  const [active, setActive] = useState(0);
  const [entryFile, setEntryFile] = useState(LANGUAGES.python.defaultEntryFile);
  const [stdin, setStdin] = useState('');
  const [timeoutMs, setTimeoutMs] = useState(Math.min(5000, maxTimeout));
  const [memoryMb, setMemoryMb] = useState(Math.min(256, maxMemory));
  const [executionId, setExecutionId] = useState<string | null>(null);

  const live = useLiveExecution(executionId);
  const create = useMutation({ mutationFn: api.createExecution, onSuccess: (r) => setExecutionId(r.id) });

  const run = useCallback(() => {
    if (create.isPending) return;
    create.mutate({
      language,
      files,
      entryFile,
      stdin,
      limits: { timeoutMs: clamp(timeoutMs, 100, maxTimeout), memoryMb: clamp(memoryMb, 16, maxMemory) },
    });
  }, [create, language, files, entryFile, stdin, timeoutMs, memoryMb, maxTimeout, maxMemory]);

  // Ctrl/Cmd+Enter outside the editor too (the editor registers its own command).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        run();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run]);

  const changeLanguage = (lang: LanguageId) => {
    setLanguage(lang);
    setFiles(starter(lang));
    setActive(0);
    setEntryFile(LANGUAGES[lang].defaultEntryFile);
  };

  const validateName = (path: string, ignore?: number): string | null => {
    if (!isSafeRelativePath(path)) return 'Use a relative path with letters, digits, ".", "_", "-" and "/".';
    if (files.some((f, i) => f.path === path && i !== ignore)) return 'A file with that name exists.';
    return null;
  };

  const current = files[active] ?? files[0]!;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">New execution</h1>
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div>
          <FileTabs
            files={files}
            active={active}
            onSelect={setActive}
            onAdd={(path) => {
              const err = validateName(path);
              if (err) return err;
              setFiles([...files, { path, content: '' }]);
              setActive(files.length);
              return null;
            }}
            onRename={(i, path) => {
              const err = validateName(path, i);
              if (err) return err;
              const old = files[i]!.path;
              setFiles(files.map((f, j) => (j === i ? { ...f, path } : f)));
              if (entryFile === old) setEntryFile(path);
              return null;
            }}
            onDelete={(i) => {
              const removed = files[i]!.path;
              const next = files.filter((_, j) => j !== i);
              setFiles(next);
              setActive(Math.max(0, i - 1));
              if (entryFile === removed) setEntryFile(next[0]!.path);
            }}
          />
          <CodeEditor
            path={current.path}
            language={LANGUAGES[language].monaco}
            value={current.content}
            onChange={(v) => setFiles((fs) => fs.map((f, i) => (i === active ? { ...f, content: v } : f)))}
            onRun={run}
          />
        </div>
        <div className="space-y-4">
          <Field label="Language">
            <Select value={language} onChange={(e) => changeLanguage(e.target.value as LanguageId)}>
              {LANGUAGE_IDS.map((id) => (
                <option key={id} value={id}>{LANGUAGES[id].label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Entry file">
            <Select value={entryFile} onChange={(e) => setEntryFile(e.target.value)}>
              {files.map((f) => (
                <option key={f.path} value={f.path}>{f.path}</option>
              ))}
            </Select>
          </Field>
          <Field label="Timeout (ms)" hint={`Max ${maxTimeout} ms`}>
            <Input type="number" min={100} max={maxTimeout} step={100} value={timeoutMs} onChange={(e) => setTimeoutMs(Number(e.target.value))} onBlur={() => setTimeoutMs(clamp(timeoutMs, 100, maxTimeout))} />
          </Field>
          <Field label="Memory (MB)" hint={`Max ${maxMemory} MB`}>
            <Input type="number" min={16} max={maxMemory} step={16} value={memoryMb} onChange={(e) => setMemoryMb(Number(e.target.value))} onBlur={() => setMemoryMb(clamp(memoryMb, 16, maxMemory))} />
          </Field>
          <Field label="stdin">
            <textarea className="h-24 w-full rounded-md border border-slate-300 bg-white p-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-900" value={stdin} onChange={(e) => setStdin(e.target.value)} />
          </Field>
          <Button className="w-full" onClick={run} disabled={create.isPending}>
            {create.isPending ? 'Submitting…' : 'Run'} <kbd className="ml-1 text-xs opacity-75">Ctrl+Enter</kbd>
          </Button>
          <ErrorNotice error={create.error} />
        </div>
      </div>

      {executionId && (
        <Card
          title="Result"
          actions={<Link className="text-sm text-indigo-600 underline dark:text-indigo-400" to={`/executions/${executionId}`}>Open details</Link>}
        >
          <ErrorNotice error={live.error} />
          {live.data ? <ExecutionSummary e={live.data} /> : <p className="text-sm text-slate-500">Loading…</p>}
        </Card>
      )}
    </div>
  );
}
