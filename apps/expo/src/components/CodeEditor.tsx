'use dom';

import { useMemo, useState, useSyncExternalStore, type Ref } from 'react';
import { useDOMImperativeHandle, type DOMImperativeFactory } from 'expo/dom';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { cpp } from '@codemirror/lang-cpp';
import { autocompletion, nextSnippetField, startCompletion } from '@codemirror/autocomplete';
import { indentMore, indentLess, indentWithTab, undo, redo } from '@codemirror/commands';
import { EditorView, keymap } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { Prec } from '@codemirror/state';
import { palettes, type ThemeMode } from '@/lib/palette';
import { completionSource } from '@/lib/completions';
import { languages } from '@/lib/languages';
import type { Language } from '@/lib/types';

// Only this component runs in the WebView's browser JS engine. Keep native modules,
// authentication and API requests outside this boundary.
export interface EditorHandle extends DOMImperativeFactory {
  requestDocument: (requestId: unknown) => void;
}
type Props = {
  ref?: Ref<EditorHandle>;
  code: string; fileId: string; readOnly: boolean; mode: ThemeMode; language: Language; fontSize: number;
  onChange: (id: string, code: string) => Promise<void>;
  onSave: (id: string, code: string) => Promise<void>;
  onRun: (id: string, code: string) => Promise<void>;
  onDocument: (requestId: string, fileId: string, code: string) => Promise<void>;
  dom?: import('expo/dom').DOMProps;
};
function createEditorTheme(mode: ThemeMode, fontSize: number) {
  const colors = palettes[mode];
  return EditorView.theme({
  '&': { height: '100%', backgroundColor: colors.editor, color: colors.text, fontSize: `${fontSize}px` },
  '.cm-scroller': { fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace', lineHeight: '1.65', overflow: 'auto', overscrollBehavior: 'contain' },
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
  '.cm-tooltip-autocomplete > ul': { maxHeight: '200px', fontSize: `${Math.max(15, fontSize - 1)}px` },
  '.cm-tooltip-autocomplete > ul > li': { padding: '10px 12px', minHeight: '38px' },
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

export default function CodeEditor({ ref, code, fileId, readOnly, mode, language, fontSize, onChange, onSave, onRun, onDocument }: Props) {
  const colors = palettes[mode];
  const theme = useMemo(() => createEditorTheme(mode, fontSize), [mode, fontSize]);
  const highlight = useMemo(() => createHighlight(mode), [mode]);
  const mounted = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const [view, setView] = useState<EditorView>();
  // Native prop updates cross an asynchronous JSON bridge. Echoing every native
  // `code` prop into a controlled editor can roll back newer keystrokes. The DOM
  // owns the live document; the parent remounts on file ID / external replacement.
  const [document, setDocument] = useState(code);
  useDOMImperativeHandle(ref ?? null, () => ({
    // Expo's native imperative proxy injects JS and returns void. Reply through
    // a native action; do not pretend the ref call returns a Promise on devices.
    requestDocument: requestId => {
      if (typeof requestId === 'string') void onDocument(requestId, fileId, view?.state.doc.toString() ?? document);
    },
  }), [fileId, view, document, onDocument]);
  const extensions = useMemo(() => [language === 'python' ? python() : language === 'node' ? javascript() : cpp(), theme, highlight,
    autocompletion({ override: [completionSource(language)], activateOnTyping: true, maxRenderedOptions: 30, defaultKeymap: true }),
    EditorView.contentAttributes.of({ 'aria-label': `${languages[language].label} code editor`, spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
    Prec.highest(keymap.of([
      { key: 'Mod-Enter', run: editor => { void onRun(fileId, editor.state.doc.toString()); return true; } },
      { key: 'Mod-s', run: editor => { void onSave(fileId, editor.state.doc.toString()); return true; } },
      indentWithTab,
    ])),
  ], [fileId, onSave, onRun, theme, highlight, language]);
  const tool = (label: string, action: (editor: EditorView) => unknown) => <button key={label} className="giga-suggest" type="button" disabled={readOnly} onPointerDown={event => event.preventDefault()} onClick={() => { if (view) { view.focus(); action(view); } }} style={{ background: colors.accentSoft, color: colors.accent, border: `1px solid ${colors.strongBorder}`, borderRadius: 8, padding: '9px 12px', minHeight: 44, flexShrink: 0, whiteSpace: 'nowrap', cursor: 'pointer', font: '13px monospace' }}>{label}</button>;
  return <div data-editor-theme={mode} style={{ height: '100%', width: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', background: colors.editor, colorScheme: mode }}>
    <style>{`html, body, #root { margin: 0; height: 100%; } ${process.env.EXPO_DOM_HOST_OS ? 'html, body { overflow: hidden; }' : ''} * { box-sizing: border-box; } .cm-editor { flex: 1; min-height: 0; } .cm-theme { height: 100%; } .giga-suggest:focus-visible { outline: 2px solid ${colors.accent}; outline-offset: 3px; }`}</style>
    <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {mounted && <CodeMirror value={document} height="100%" theme={theme} extensions={extensions} readOnly={readOnly}
        basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true, autocompletion: true, tabSize: 4 }}
        onCreateEditor={setView} onChange={value => { setDocument(value); void onChange(fileId, value); }} />}
    </div>
    <div aria-label="Editor touch tools" style={{ borderTop: `1px solid ${colors.border}`, padding: '7px 10px', display: 'flex', overflowX: 'auto', flexShrink: 0, alignItems: 'center', gap: 6, font: '12px monospace', color: colors.muted }}>
      {tool('Suggest ↗', startCompletion)}{tool('Indent →', indentMore)}{tool('← Outdent', indentLess)}{tool('Next field', nextSnippetField)}
      {tool('Undo', undo)}{tool('Redo', redo)}{tool('Hide keyboard', editor => editor.contentDOM.blur())}
      <span style={{ whiteSpace: 'nowrap' }}>{languages[language].label} · UTF-8 · 4 spaces</span>
    </div>
  </div>;
}
