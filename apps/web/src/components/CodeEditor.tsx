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

// Editor themes share the app's card colours so the editor sits flush inside its panel.
monaco.editor.defineTheme('gigacode-light', {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: { 'editor.background': '#ffffff', 'editorGutter.background': '#ffffff', 'editor.lineHighlightBackground': '#f6f5f3' },
});
monaco.editor.defineTheme('gigacode-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: { 'editor.background': '#191715', 'editorGutter.background': '#191715', 'editor.lineHighlightBackground': '#221f1d' },
});

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
    <div className="h-full min-h-[280px] w-full overflow-hidden">
      <Editor
        path={path}
        language={language}
        value={value}
        theme={dark ? 'gigacode-dark' : 'gigacode-light'}
        onChange={(v) => onChange(v ?? '')}
        onMount={onMount}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          fontFamily: '"JetBrains Mono Variable", ui-monospace, monospace',
          automaticLayout: true,
          scrollBeyondLastLine: false,
          padding: { top: 12, bottom: 12 },
          renderLineHighlight: 'line',
          tabSize: 4,
        }}
      />
    </div>
  );
}
