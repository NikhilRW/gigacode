'use dom';

import { useMemo, useState, useSyncExternalStore, type Ref } from 'react';
import { useDOMImperativeHandle, type DOMImperativeFactory } from 'expo/dom';
import { Asset } from 'expo-asset';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { cpp } from '@codemirror/lang-cpp';
import { autocompletion } from '@codemirror/autocomplete';
import { indentWithTab } from '@codemirror/commands';
import { EditorView, keymap } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { Prec } from '@codemirror/state';
import { plainEditorPalettes, type ThemeMode } from '@/lib/palette';
import { completionSource } from '@/lib/completions';
import { languages } from '@/lib/languages';
import type { Language } from '@/lib/types';

// Resolve bundled files in this browser bundle, not through native font registration.
// Metro does not rewrite local url() resources in CSS, so use its asset pipeline.
const codeFont = Asset.fromModule(
  require('@expo-google-fonts/jetbrains-mono/400Regular/JetBrainsMono_400Regular.ttf'),
).uri;
const codeItalic = Asset.fromModule(
  require('@expo-google-fonts/jetbrains-mono/400Regular_Italic/JetBrainsMono_400Regular_Italic.ttf'),
).uri;

// Only this component runs in the WebView's browser JS engine. Keep native modules,
// authentication and API requests outside this boundary.
export interface EditorHandle extends DOMImperativeFactory {
  requestDocument: (requestId: unknown) => void;
}
type Props = {
  ref?: Ref<EditorHandle>;
  code: string;
  fileId: string;
  readOnly: boolean;
  mode: ThemeMode;
  language: Language;
  fontSize: number;
  onChange: (id: string, code: string) => Promise<void>;
  onSave: (id: string, code: string) => Promise<void>;
  onRun: (id: string, code: string) => Promise<void>;
  onDocument: (requestId: string, fileId: string, code: string) => Promise<void>;
  dom?: import('expo/dom').DOMProps;
};
function createPlainEditorTheme(mode: ThemeMode, fontSize: number) {
  const colors = plainEditorPalettes[mode];
  return EditorView.theme(
    {
      '&': {
        minHeight: '220px',
        backgroundColor: colors.background,
        color: colors.text,
        fontSize: `${fontSize}px`,
      },
      '.cm-scroller': {
        fontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
        lineHeight: '1.5',
        overflow: 'visible',
      },
      '.cm-content': { padding: '8px 0', caretColor: colors.text },
      '.cm-line': { padding: '0 4px' },
      '.cm-gutters': {
        backgroundColor: 'transparent',
        color: colors.muted,
        border: 'none',
        padding: '0',
        minWidth: '0',
      },
      '.cm-lineNumbers .cm-gutterElement': { minWidth: '0', padding: '0 4px 0 6px' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: colors.text },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
        backgroundColor: `${colors.selection} !important`,
      },
      '.cm-searchMatch, .cm-matchingBracket': { backgroundColor: colors.selection, color: 'inherit' },
      '&.cm-focused': { outline: 'none' },
      '.cm-tooltip, .cm-panels': {
        backgroundColor: colors.background,
        color: colors.text,
        border: `1px solid ${colors.border}`,
        borderRadius: '6px',
        overflow: 'hidden',
      },
      '.cm-tooltip-autocomplete > ul': { maxHeight: '200px', fontSize: `${Math.max(15, fontSize - 1)}px` },
      '.cm-tooltip-autocomplete > ul > li': { padding: '10px 12px', minHeight: '38px' },
      '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
        backgroundColor: colors.selection,
        color: colors.text,
      },
      '.cm-completionDetail, .cm-completionInfo': { color: colors.muted },
    },
    { dark: mode === 'dark' },
  );
}
function createHighlight(mode: ThemeMode) {
  const colors = plainEditorPalettes[mode];
  return syntaxHighlighting(
    HighlightStyle.define([
      { tag: tags.keyword, color: colors.syntaxKeyword },
      { tag: [tags.string, tags.special(tags.string)], color: colors.syntaxString },
      { tag: tags.comment, color: colors.syntaxComment, fontStyle: 'italic' },
      {
        tag: [
          tags.function(tags.variableName),
          tags.function(tags.propertyName),
          tags.standard(tags.variableName),
        ],
        color: colors.syntaxFunction,
      },
      { tag: [tags.number, tags.bool, tags.null], color: colors.syntaxNumber },
      { tag: tags.typeName, color: colors.syntaxKeyword },
      { tag: tags.operator, color: colors.syntaxOperator },
    ]),
  );
}
const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export default function CodeEditor({
  ref,
  code,
  fileId,
  readOnly,
  mode,
  language,
  fontSize,
  onChange,
  onSave,
  onRun,
  onDocument,
}: Props) {
  const colors = plainEditorPalettes[mode];
  const theme = useMemo(() => createPlainEditorTheme(mode, fontSize), [mode, fontSize]);
  const highlight = useMemo(() => createHighlight(mode), [mode]);
  const mounted = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const [view, setView] = useState<EditorView>();
  // Native prop updates cross an asynchronous JSON bridge. Echoing every native
  // `code` prop into a controlled editor can roll back newer keystrokes. The DOM
  // owns the live document; the parent remounts on file ID / external replacement.
  const [document, setDocument] = useState(code);
  useDOMImperativeHandle(
    ref ?? null,
    () => ({
      // Expo's native imperative proxy injects JS and returns void. Reply through
      // a native action; do not pretend the ref call returns a Promise on devices.
      requestDocument: (requestId) => {
        if (typeof requestId === 'string')
          void onDocument(requestId, fileId, view?.state.doc.toString() ?? document);
      },
    }),
    [fileId, view, document, onDocument],
  );
  const extensions = useMemo(
    () => [
      language === 'python' ? python() : language === 'node' ? javascript() : cpp(),
      theme,
      highlight,
      EditorView.lineWrapping,
      autocompletion({
        override: [completionSource(language)],
        activateOnTyping: true,
        maxRenderedOptions: 30,
        defaultKeymap: true,
      }),
      EditorView.contentAttributes.of({
        'aria-label': `${languages[language].label} code editor`,
        spellcheck: 'false',
        autocapitalize: 'off',
        autocorrect: 'off',
      }),
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-Enter',
            run: (editor) => {
              void onRun(fileId, editor.state.doc.toString());
              return true;
            },
          },
          {
            key: 'Mod-s',
            run: (editor) => {
              void onSave(fileId, editor.state.doc.toString());
              return true;
            },
          },
          indentWithTab,
        ]),
      ),
    ],
    [fileId, onSave, onRun, theme, highlight, language],
  );
  return (
    <div
      data-editor-theme={mode}
      style={{ width: '100%', minWidth: 0, background: colors.background, colorScheme: mode }}
    >
      <style>{`
        @font-face { font-family: "JetBrains Mono"; src: url(${JSON.stringify(codeFont)}) format("truetype"); font-weight: 400; font-style: normal; font-display: swap; }
        @font-face { font-family: "JetBrains Mono"; src: url(${JSON.stringify(codeItalic)}) format("truetype"); font-weight: 400; font-style: italic; font-display: swap; }
      `}</style>
      {process.env.EXPO_DOM_HOST_OS && (
        <style>{`html, body { margin: 0; padding: 0; height: auto; min-height: 0; overflow: hidden; background: ${colors.background}; color-scheme: ${mode}; }`}</style>
      )}
      <div style={{ minWidth: 0 }}>
        {mounted && (
          <CodeMirror
            value={document}
            theme={theme}
            extensions={extensions}
            readOnly={readOnly}
            basicSetup={{
              lineNumbers: true,
              foldGutter: false,
              highlightActiveLine: false,
              highlightActiveLineGutter: false,
              highlightSelectionMatches: false,
              syntaxHighlighting: true,
              autocompletion: true,
              tabSize: 4,
            }}
            onCreateEditor={setView}
            onChange={(value) => {
              setDocument(value);
              void onChange(fileId, value);
            }}
          />
        )}
      </div>
    </div>
  );
}
