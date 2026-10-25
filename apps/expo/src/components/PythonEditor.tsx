'use dom';

import { useMemo, useState, useSyncExternalStore } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { startCompletion } from '@codemirror/autocomplete';
import { EditorView, keymap } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { Prec } from '@codemirror/state';
import { palettes, type ThemeMode } from '@/lib/palette';

type Props = {
  code: string; fileId: string; readOnly: boolean; mode: ThemeMode;
  onChange: (id: string, code: string) => Promise<void>;
  onSave: (id: string, code: string) => Promise<void>;
  onRun: () => Promise<void>;
  dom?: import('expo/dom').DOMProps;
};
function createEditorTheme(mode: ThemeMode) {
  const colors = palettes[mode];
  return EditorView.theme({
  '&': { height: '100%', backgroundColor: colors.editor, color: colors.text, fontSize: '13px' },
  '.cm-scroller': { fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace', lineHeight: '1.95', overflow: 'auto' },
  '.cm-content': { padding: '23px 0', caretColor: colors.accent },
  '.cm-line': { padding: '0 16px' },
  // CodeMirror offsets gutter lines by the content padding; don't add it again here.
  '.cm-gutters': { backgroundColor: colors.editor, color: colors.faint, border: 'none', padding: '0 0 0 12px', minWidth: '38px' },
  '.cm-activeLineGutter': { backgroundColor: colors.accentSoft, color: colors.accent },
  '.cm-activeLine': { backgroundColor: colors.accentSoft },
  '.cm-cursor': { borderLeftColor: colors.accent },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: `${colors.selection} !important` },
  '.cm-selectionMatch, .cm-searchMatch': { backgroundColor: colors.selection },
  '&.cm-focused': { outline: 'none' },
  '.cm-tooltip, .cm-panels': { backgroundColor: colors.panel, color: colors.text, border: `1px solid ${colors.strongBorder}`, borderRadius: '8px', overflow: 'hidden' },
  '.cm-tooltip-autocomplete > ul > li': { padding: '8px 12px', minHeight: '28px' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: colors.selection, color: colors.text },
  '.cm-completionDetail, .cm-completionInfo': { color: colors.muted },
  '.cm-matchingBracket': { backgroundColor: colors.selection, color: colors.accent },
}, { dark: mode === 'dark' });
}
function createHighlight(mode: ThemeMode) {
  const colors = palettes[mode];
  return syntaxHighlighting(HighlightStyle.define([
    { tag: tags.keyword, color: colors.syntaxKeyword },
    { tag: [tags.string, tags.special(tags.string)], color: colors.syntaxString },
    { tag: tags.comment, color: colors.syntaxComment, fontStyle: 'italic' },
    { tag: [tags.function(tags.variableName), tags.standard(tags.variableName)], color: colors.syntaxFunction },
    { tag: [tags.number, tags.bool], color: colors.syntaxNumber },
    { tag: tags.operator, color: colors.syntaxOperator },
  ]));
}
const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export default function PythonEditor({ code, fileId, readOnly, mode, onChange, onSave, onRun }: Props) {
  const colors = palettes[mode];
  const theme = useMemo(() => createEditorTheme(mode), [mode]);
  const highlight = useMemo(() => createHighlight(mode), [mode]);
  const mounted = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const [view, setView] = useState<EditorView>();
  const extensions = useMemo(() => [python(), theme, highlight,
    EditorView.contentAttributes.of({ 'aria-label': 'Python code editor', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
    Prec.highest(keymap.of([
      { key: 'Mod-Enter', run: () => { void onRun(); return true; } },
      { key: 'Mod-s', run: editor => { void onSave(fileId, editor.state.doc.toString()); return true; } },
    ])),
  ], [fileId, onSave, onRun, theme, highlight]);
  return <div data-editor-theme={mode} style={{ height: '100%', width: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', background: colors.editor, colorScheme: mode }}>
    <style>{`.cm-editor { flex: 1; min-height: 0; } .cm-theme { height: 100%; } .giga-suggest:focus-visible { outline: 2px solid ${colors.accent}; outline-offset: 3px; }`}</style>
    <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {mounted && <CodeMirror value={code} height="100%" theme={theme} extensions={extensions} readOnly={readOnly}
        basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true, autocompletion: true, tabSize: 4 }}
        onCreateEditor={setView} onChange={value => { void onChange(fileId, value); }} />}
    </div>
    <div style={{ borderTop: `1px solid ${colors.border}`, padding: '7px 14px', display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between', font: '10px monospace', color: colors.muted }}>
      <span>Python · UTF-8 · 4 spaces</span>
      <button className="giga-suggest" type="button" disabled={readOnly} aria-label="Show Python autocomplete suggestions" onClick={() => { if (view) { view.focus(); startCompletion(view); } }} style={{ background: colors.accentSoft, color: colors.accent, border: `1px solid ${colors.strongBorder}`, borderRadius: 8, padding: '7px 10px', cursor: 'pointer', font: '11px monospace' }}>Suggest ↗</button>
    </div>
  </div>;
}
