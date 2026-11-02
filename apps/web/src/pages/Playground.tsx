import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { ExternalLink, Loader2, Play, SlidersHorizontal, Square, Wifi, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import type { LanguageId } from '@engine/shared';
import { HARD_LIMITS } from '@shared/constants.ts';
import { LANGUAGES, LANGUAGE_IDS } from '@shared/languages.ts';
import { isTerminal } from '@shared/states.ts';
import { api, type ExecutionSource } from '@/api/endpoints';
import { describeError } from '@/api/client';
import { useRequiredMe } from '@/auth';
import { CodeEditor } from '@/components/CodeEditor';
import { FileTabs, type SourceFile } from '@/components/FileTabs';
import { MetricChips, LogsPanel, OutcomeNotice } from '@/components/RunOutput';
import { RunProgress } from '@/components/RunProgress';
import { StatusChip } from '@/components/StatusChip';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useMediaQuery } from '@/hooks/use-media-query';
import { formatMs } from '@/lib/format';
import { useLiveExecution } from '@/lib/useLiveExecution';

const DRAFT_KEY = 'gigacode.playground.v1';

interface Draft {
  language: LanguageId;
  files: SourceFile[];
  entryFile: string;
  stdin: string;
  timeoutMs: number;
  memoryMb: number;
  cpuMsPerSec: number;
  pids: number;
  network: boolean;
}

function starter(lang: LanguageId): SourceFile[] {
  const cfg = LANGUAGES[lang];
  return [{ path: cfg.defaultEntryFile, content: cfg.helloWorld.replace('hello', 'hello, world') }];
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, Number.isFinite(v) ? v : min));
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const RUN_KEYS = isMac ? '⌘↵' : 'Ctrl+↵';

function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    if (!LANGUAGES[d.language] || !Array.isArray(d.files) || d.files.length === 0) return null;
    return d;
  } catch {
    return null;
  }
}

function isUntouchedStarter(language: LanguageId, files: SourceFile[]): boolean {
  const s = starter(language);
  return files.length === 1 && files[0]?.path === s[0]?.path && files[0]?.content === s[0]?.content;
}

export function PlaygroundPage() {
  const me = useRequiredMe();
  const qc = useQueryClient();
  const location = useLocation();
  const maxTimeout = Math.min(me.limits.maxTimeoutMs, HARD_LIMITS.timeoutMs);
  const maxMemory = Math.min(me.limits.maxMemoryMb, HARD_LIMITS.memoryMb);

  const initial = useMemo<Draft>(() => {
    const source = (location.state as { source?: ExecutionSource } | null)?.source;
    if (source) {
      return {
        language: source.language,
        files: source.files,
        entryFile: source.entryFile,
        stdin: source.stdin,
        timeoutMs: clamp(source.limits.timeoutMs, 100, maxTimeout),
        memoryMb: clamp(source.limits.memoryMb, 16, maxMemory),
        cpuMsPerSec: source.limits.cpuMsPerSec,
        pids: source.limits.pids,
        network: source.network === true,
      };
    }
    return (
      loadDraft() ?? {
        language: 'python',
        files: starter('python'),
        entryFile: LANGUAGES.python.defaultEntryFile,
        stdin: '',
        timeoutMs: Math.min(5000, maxTimeout),
        memoryMb: Math.min(256, maxMemory),
        cpuMsPerSec: 1000,
        pids: 64,
        network: false,
      }
    );
    // Only the first render decides the starting state.
  }, []);

  const [language, setLanguage] = useState<LanguageId>(initial.language);
  const [files, setFiles] = useState<SourceFile[]>(initial.files);
  const [active, setActive] = useState(0);
  const [entryFile, setEntryFile] = useState(initial.entryFile);
  const [stdin, setStdin] = useState(initial.stdin);
  const [timeoutMs, setTimeoutMs] = useState(initial.timeoutMs);
  const [memoryMb, setMemoryMb] = useState(initial.memoryMb);
  const [cpuMsPerSec, setCpu] = useState(initial.cpuMsPerSec ?? 1000);
  const [pids, setPids] = useState(initial.pids ?? 64);
  const [network, setNetwork] = useState(initial.network ?? false);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [panel, setPanel] = useState<'input' | 'output'>('output');
  const [pendingLanguage, setPendingLanguage] = useState<LanguageId | null>(null);
  const desktop = useMediaQuery('(min-width: 1024px)');

  // Keep the draft across reloads and navigation (best effort; storage can be unavailable).
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ language, files, entryFile, stdin, timeoutMs, memoryMb, cpuMsPerSec, pids, network } satisfies Draft));
      } catch {
        /* private mode or storage disabled: the draft just isn't saved */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [language, files, entryFile, stdin, timeoutMs, memoryMb, cpuMsPerSec, pids, network]);

  const live = useLiveExecution(executionId);
  const run = live.data;
  const active_ = !!run && !isTerminal(run.status);

  const create = useMutation({
    mutationFn: api.createExecution,
    onSuccess: (r) => {
      setExecutionId(r.id);
      setPanel('output');
      void qc.invalidateQueries({ queryKey: ['onboarding'] });
      void qc.invalidateQueries({ queryKey: ['usage'] });
    },
    onError: (err) => toast.error(describeError(err)),
  });
  const cancel = useMutation({
    mutationFn: () => api.cancelExecution(executionId!),
    onSuccess: () => toast.success('Cancelling…'),
    onError: (err) => toast.error(describeError(err)),
  });

  const busy = create.isPending || active_;
  const runRef = useRef<() => void>(() => {});
  const doRun = useCallback(() => {
    if (busy) return;
    create.mutate({
      language,
      files,
      entryFile,
      stdin,
      network,
      limits: { timeoutMs: clamp(timeoutMs, 100, maxTimeout), memoryMb: clamp(memoryMb, 16, maxMemory), cpuMsPerSec: clamp(cpuMsPerSec, 1, 1000), pids: clamp(pids, 1, 64) },
    });
  }, [busy, create, language, files, entryFile, stdin, timeoutMs, memoryMb, cpuMsPerSec, pids, network, maxTimeout, maxMemory]);
  runRef.current = doRun;

  // Ctrl/Cmd+Enter anywhere on the page (the editor registers its own binding too).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        runRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const applyLanguage = (lang: LanguageId) => {
    setLanguage(lang);
    setFiles(starter(lang));
    setActive(0);
    setEntryFile(LANGUAGES[lang].defaultEntryFile);
  };
  const requestLanguage = (lang: LanguageId) => {
    if (lang === language) return;
    if (isUntouchedStarter(language, files)) applyLanguage(lang);
    else setPendingLanguage(lang);
  };

  const current = files[active] ?? files[0]!;

  const editorPane = (
    <div className="flex h-full min-h-[360px] flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
      <FileTabs
        files={files}
        active={active}
        entryFile={entryFile}
        onSelect={setActive}
        onAdd={(path) => {
          setFiles([...files, { path, content: '' }]);
          setActive(files.length);
        }}
        onRename={(i, path) => {
          const old = files[i]!.path;
          setFiles(files.map((f, j) => (j === i ? { ...f, path } : f)));
          if (entryFile === old) setEntryFile(path);
        }}
        onDelete={(i) => {
          const removed = files[i]!.path;
          const next = files.filter((_, j) => j !== i);
          setFiles(next);
          setActive(Math.max(0, i - 1));
          if (entryFile === removed) setEntryFile(next[0]!.path);
        }}
      />
      <div className="min-h-0 flex-1">
        <CodeEditor
          path={current.path}
          language={LANGUAGES[language].monaco}
          value={current.content}
          onChange={(v) => setFiles((fs) => fs.map((f, i) => (i === active ? { ...f, content: v } : f)))}
          onRun={doRun}
        />
      </div>
    </div>
  );

  const outputPane = (
    <div className="flex h-full min-h-[320px] flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
      <Tabs value={panel} onValueChange={(v) => setPanel(v as 'input' | 'output')} className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b bg-muted/40 px-2 py-1.5">
          <TabsList className="h-8 bg-transparent p-0">
            <TabsTrigger value="output" className="h-7 data-[state=active]:bg-card data-[state=active]:shadow-raised">
              Output
            </TabsTrigger>
            <TabsTrigger value="input" className="h-7 data-[state=active]:bg-card data-[state=active]:shadow-raised">
              Input
            </TabsTrigger>
          </TabsList>
          {run && (
            <div className="flex items-center gap-2">
              <StatusChip status={run.status} />
              <Button asChild variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs">
                <Link to={`/executions/${run.id}`}>
                  Details <ExternalLink className="size-3" aria-hidden />
                </Link>
              </Button>
            </div>
          )}
        </div>

        <TabsContent value="output" className="m-0 min-h-0 flex-1 overflow-auto p-4 data-[state=inactive]:hidden">
          {!executionId ? (
            <div className="grid h-full min-h-48 place-items-center text-center">
              <div>
                <p className="text-sm font-medium">Run your code to see the output here</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Press <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px]">{RUN_KEYS}</kbd> or use the Run button.
                </p>
              </div>
            </div>
          ) : !run ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Submitting…
            </div>
          ) : (
            <div className="flex h-full flex-col gap-4">
              <div className="flex items-center gap-3">
                <RunProgress status={run.status} attempt={run.attempt} />
                {active_ && (
                  <Button variant="outline" size="sm" className="shrink-0" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
                    <Square className="size-3.5" aria-hidden /> Cancel
                  </Button>
                )}
              </div>
              {isTerminal(run.status) && (
                <>
                  <OutcomeNotice e={run} />
                  <MetricChips e={run} />
                </>
              )}
              <LogsPanel e={run} className="flex-1" />
            </div>
          )}
        </TabsContent>

        <TabsContent value="input" className="m-0 min-h-0 flex-1 overflow-auto p-4 data-[state=inactive]:hidden">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="stdin">Standard input</Label>
              <Textarea
                id="stdin"
                value={stdin}
                onChange={(e) => setStdin(e.target.value)}
                placeholder="Text your program reads from stdin (optional)"
                className="min-h-40 font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">Up to 256 KB. Sent to the program exactly as typed.</p>
            </div>
            {files.length > 1 && (
              <div className="space-y-2">
                <Label htmlFor="entry">Entry file</Label>
                <Select value={entryFile} onValueChange={setEntryFile}>
                  <SelectTrigger id="entry" className="font-mono text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {files.map((f) => (
                      <SelectItem key={f.path} value={f.path} className="font-mono text-xs">
                        {f.path}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">The file the program starts from.</p>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );

  return (
    <div className="flex flex-col gap-4 lg:h-[calc(100svh-5rem)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Playground</h1>
          <p className="text-xs text-muted-foreground">Write code, run it in an isolated sandbox, see the result.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={language} onValueChange={(v) => requestLanguage(v as LanguageId)}>
            <SelectTrigger className="w-40" aria-label="Language">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGE_IDS.map((id) => (
                <SelectItem key={id} value={id}>
                  {LANGUAGES[id].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button variant={network ? 'default' : 'outline'} role="switch" aria-checked={network} aria-label="Program internet access"
            title="Outbound public TCP/UDP and DNS for the next run. Private/local destinations remain blocked."
            onClick={() => setNetwork(value => !value)} className="gap-2">
            {network ? <Wifi className="size-4" aria-hidden /> : <WifiOff className="size-4" aria-hidden />}
            Internet {network ? 'On' : 'Off'}
          </Button>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="gap-2">
                <SlidersHorizontal className="size-4" aria-hidden />
                <span className="sr-only sm:not-sr-only">Limits</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {formatMs(timeoutMs)} · {memoryMb} MB
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 space-y-4">
              <div>
                <p className="text-sm font-medium">Run limits</p>
                <p className="text-xs text-muted-foreground">Programs are stopped when they pass these.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="timeout">Time limit (seconds)</Label>
                <Input
                  id="timeout"
                  type="number"
                  inputMode="decimal"
                  min={0.1}
                  max={maxTimeout / 1000}
                  step={0.5}
                  value={timeoutMs / 1000}
                  onChange={(e) => setTimeoutMs(Math.round(Number(e.target.value) * 1000))}
                  onBlur={() => setTimeoutMs(clamp(timeoutMs, 100, maxTimeout))}
                />
                <p className="text-xs text-muted-foreground">Up to {maxTimeout / 1000} s for your workspace.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="memory">Memory (MB)</Label>
                <Input
                  id="memory"
                  type="number"
                  inputMode="numeric"
                  min={16}
                  max={maxMemory}
                  step={16}
                  value={memoryMb}
                  onChange={(e) => setMemoryMb(Math.round(Number(e.target.value)))}
                  onBlur={() => setMemoryMb(clamp(memoryMb, 16, maxMemory))}
                />
                <p className="text-xs text-muted-foreground">Up to {maxMemory} MB for your workspace.</p>
              </div>
              <div className="space-y-2">
                <Label>CPU allowance · {cpuMsPerSec / 10}% of one core</Label>
                <div className="flex flex-wrap gap-1">{[250, 500, 750, 1000].map(value => <Button key={value} size="sm" variant={cpuMsPerSec === value ? 'default' : 'outline'} onClick={() => setCpu(value)}>{value / 10}%</Button>)}</div>
              </div>
              <div className="space-y-2">
                <Label>Processes / threads · {pids}</Label>
                <div className="flex flex-wrap gap-1">{[8, 16, 32, 64].map(value => <Button key={value} size="sm" variant={pids === value ? 'default' : 'outline'} onClick={() => setPids(value)}>{value}</Button>)}</div>
                <p className="text-xs text-muted-foreground">Low process limits can prevent runtime startup. Limits and internet settings apply to the next run.</p>
              </div>
            </PopoverContent>
          </Popover>

          <Button size="lg" onClick={doRun} disabled={busy} aria-keyshortcuts="Control+Enter Meta+Enter">
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Play aria-hidden />}
            {busy ? 'Running…' : 'Run'}
            {!busy && <kbd className="ml-1 hidden rounded bg-primary-foreground/15 px-1.5 font-mono text-[11px] sm:inline">{RUN_KEYS}</kbd>}
          </Button>
        </div>
      </div>

      {desktop ? (
        <ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1">
          <ResizablePanel defaultSize={58} minSize={30}>
            {editorPane}
          </ResizablePanel>
          <ResizableHandle withHandle className="mx-1 bg-transparent" />
          <ResizablePanel defaultSize={42} minSize={25}>
            {outputPane}
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="h-[420px]">{editorPane}</div>
          {outputPane}
        </div>
      )}

      <AlertDialog open={pendingLanguage !== null} onOpenChange={(o) => !o && setPendingLanguage(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch to {pendingLanguage ? LANGUAGES[pendingLanguage].label : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              Your current files will be replaced by that language&apos;s starter program. Copy anything you want to keep first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep my code</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingLanguage) applyLanguage(pendingLanguage);
                setPendingLanguage(null);
              }}
            >
              Switch language
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
