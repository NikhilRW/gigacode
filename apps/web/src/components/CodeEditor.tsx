import Editor, { loader, type OnMount } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { useEffect, useRef, useState } from 'react';
import { currentTheme } from '../lib/theme.ts';

// Bundle Monaco locally instead of loading it from a CDN.
self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'json') return new JsonWorker();
    if (label === 'typescript' || label === 'javascript') return new TsWorker();
    return new EditorWorker();
  },
};
loader.config({ monaco });

function useIsDark() {
  const [dark, setDark] = useState(() => currentTheme() === 'dark');
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(currentTheme() === 'dark'));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

export function CodeEditor({
  path,
  language,
  value,
  onChange,
  onRun,
}: {
  path: string;
  language: string;
  value: string;
  onChange: (v: string) => void;
  onRun: () => void;
}) {
  const dark = useIsDark();
  const runRef = useRef(onRun);
  runRef.current = onRun;

  const onMount: OnMount = (editor, m) => {
    editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.Enter, () => runRef.current());
  };

  return (
    <div className="h-[420px] overflow-hidden rounded-b-md border border-t-0 border-slate-300 dark:border-slate-700">
      <Editor
        path={path}
        language={language}
        value={value}
        theme={dark ? 'vs-dark' : 'light'}
        onChange={(v) => onChange(v ?? '')}
        onMount={onMount}
        options={{ minimap: { enabled: false }, fontSize: 14, automaticLayout: true, scrollBeyondLastLine: false }}
      />
    </div>
  );
}
