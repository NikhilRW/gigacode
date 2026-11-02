import { useRef, useState } from 'react';
import { Stack } from 'expo-router';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Brand, Button, Icon, Notice, Pill, ThemeToggle } from '@/components/ui';
import { Orbit } from '@/components/Orbit';
import { FilesPanel } from '@/components/FilesPanel';
import { FileNameModal } from '@/components/FileNameModal';
import CodeEditor from '@/components/CodeEditor';
import { useEditorBridge } from '@/lib/useEditorBridge';
import { Field, FlowRow, Navigation, ResourceState } from '@/components/AppScreen';
import { RunOutput } from '@/components/RunOutput';
import { useAuth } from '@/state/AuthProvider';
import { describeError } from '@/lib/client';
import { executionSource } from '@/lib/drafts';
import { languageIds, languages } from '@/lib/languages';
import { useLiveRun } from '@/lib/useResource';
import { terminal } from '@/lib/types';
import { useDrafts } from '@/state/DraftProvider';
import { font, mono, type Colors } from '@/theme';
import { useStyles, useTheme } from '@/state/ThemeProvider';

export default function Workspace() {
  const auth = useAuth();
  return <WorkspaceContent key={`${auth.baseUrl}:${auth.me?.user.id ?? 'guest'}`} />;
}

function WorkspaceContent() {
  const { colors, common, mode } = useTheme();
  const styles = useStyles(createStyles);
  const { width, height } = useWindowDimensions();
  const desktop = width >= 960;
  const splitConsole = width >= 1200;
  const compact = width < 600;
  const drafts = useDrafts();
  const auth = useAuth();
  const file = drafts.library.files.find(item => item.id === drafts.library.activeId) ?? drafts.library.files[0];
  const [filesVisible, setFilesVisible] = useState(false);
  const [nameMode, setNameMode] = useState<'new' | 'rename' | null>(null);
  const [helpVisible, setHelpVisible] = useState(false);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [runError, setRunError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [focusEditor, setFocusEditor] = useState(false);
  const submitLock = useRef(false);
  const { editor, readDocument, onDocument } = useEditorBridge(file.id, focusEditor);
  const live = useLiveRun(executionId);
  const runData = live.data?.execution.id === executionId && auth.signedIn ? live.data : undefined;
  const activeRun = !!executionId && (!runData || !terminal(runData.execution.status));
  const run = async (id?: string, code?: string) => {
    if (!auth.me) { setRunError('Sign in to execute code. Your local drafts are preserved.'); return; }
    if (submitLock.current || activeRun || !drafts.ready) return;
    submitLock.current = true; setSubmitting(true); setRunError('');
    try {
      if (id && code !== undefined) drafts.edit(id, code);
      else await syncEditor();
      const source = executionSource(drafts.snapshot(), auth.me.limits);
      const response = await auth.api.request<{ id: string }>('POST', '/v1/executions', { body: source });
      setExecutionId(response.id);
    } catch (err) { setRunError(describeError(err)); }
    finally { submitLock.current = false; setSubmitting(false); }
  };
  const syncEditor = async () => {
    const latest = await readDocument();
    drafts.edit(latest.fileId, latest.code);
  };
  const save = async () => {
    try { await syncEditor(); await drafts.save(); }
    catch (err) { setRunError(describeError(err)); }
  };
  const toggleFocus = async () => {
    try { await syncEditor(); setFocusEditor(value => !value); }
    catch (err) { setRunError(describeError(err)); }
  };
  const cancel = async () => {
    if (!executionId) return;
    setCancelling(true); setRunError('');
    try { await auth.api.request('POST', `/v1/executions/${encodeURIComponent(executionId)}/cancel`); live.reload(); }
    catch (err) { setRunError(describeError(err)); } finally { setCancelling(false); }
  };
  const saveFromEditor = async (id: string, code: string) => { drafts.edit(id, code); await drafts.save(); };
  const statusText = { loading: 'Opening device drafts…', saved: 'Saved on device', unsaved: 'Unsaved changes', saving: 'Saving on device…', error: 'Storage needs attention' }[drafts.status];
  const editorView = drafts.ready ? <CodeEditor ref={editor} key={file.id} fileId={file.id} code={file.code} readOnly={false} mode={mode} language={drafts.library.language} fontSize={drafts.library.fontSize}
    onChange={async (id, code) => drafts.edit(id, code)} onSave={saveFromEditor} onRun={run} onDocument={onDocument}
    dom={{ style: { flex: 1, backgroundColor: colors.editor }, scrollEnabled: true }} /> : <Text style={common.muted}>Opening device drafts…</Text>;

  // A dedicated flex layout keeps the editor above the software keyboard. Avoid
  // nesting a viewport-sized editor in the page ScrollView while in focus mode.
  if (focusEditor) return <SafeAreaView style={styles.safe}>
    <Stack.Screen options={{ title: `${file.name} — GigaCode` }} />
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.editorHeader, { paddingHorizontal: 12 }]}>
        <Button label="Done" compact onPress={() => { void toggleFocus(); }} />
        <Text numberOfLines={1} style={[common.text, { flex: 1 }]}>{file.name}</Text>
        <Button label="Save" compact onPress={() => { void save(); }} />
        <Button label={submitting ? 'Sending…' : 'Run'} variant="primary" compact disabled={submitting || activeRun} onPress={() => { void run(); }} />
      </View>
      <View style={{ flex: 1, minHeight: 0 }}>{editorView}</View>
      <View style={[styles.statusBar, { gap: 8, flexWrap: 'wrap' }]}>
        <Text style={styles.status}>{statusText}{runData ? ` · ${runData.execution.status}` : ''}</Text>
        <Button label="Output & settings" compact onPress={() => { void toggleFocus(); }} />
      </View>
      {!!runError && <Notice>{runError}</Notice>}
      {drafts.error && <Notice>{drafts.error}</Notice>}
    </KeyboardAvoidingView>
  </SafeAreaView>;

  return <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
    <Stack.Screen options={{ title: 'GigaCode — A little code. Infinite possibilities.' }} />
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView nestedScrollEnabled contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <View style={[styles.page, compact && { paddingHorizontal: 18 }]}>
          <View style={styles.header}>
            <View style={common.row}><Brand />{!compact && <View style={styles.headerDivider} />}{!compact && <Text style={styles.headerLabel}>YOUR CODE PLAYGROUND</Text>}</View>
            <View style={[common.row, { gap: compact ? 4 : 12 }]}>
              <ThemeToggle />
              <Button label={auth.signedIn ? 'Dashboard' : 'Sign in'} href={auth.signedIn ? '/dashboard' : '/login'} variant="ghost" compact />
              {!compact && !auth.signedIn && <Button label="Create account" href="/signup" icon="arrow-up-right" compact />}
            </View>
          </View>
          <Navigation />

          {!focusEditor && <View style={[styles.hero, compact && { paddingTop: 24, paddingBottom: 24, minHeight: 230 }]}>
            <View style={{ flex: 1, zIndex: 1 }}>
              <Pill label="A SPACE FOR YOUR NEXT BIG IDEA" dot />
              <Text accessibilityRole="header" style={[styles.heading, width < 1200 && { fontSize: 48, lineHeight: 54 }, compact && { fontSize: 36, lineHeight: 42, letterSpacing: -1.8 }]}>A little code.{"\n"}<Text style={{ color: colors.accent }}>Infinite possibilities.</Text></Text>
              <Text style={[common.muted, { marginTop: 17, maxWidth: 420, fontSize: 15 }]}>Less setup. More discovery. A quiet space to write Python, JavaScript, C and C++, then run in an isolated sandbox.</Text>
            </View>
            {width >= 1000 && <View style={styles.heroOrbit}><Orbit compact /><View style={styles.orbitCaption}><View style={styles.tinyDot} /><Text style={styles.orbitLabel}>YOUR IDEAS HAVE NO LIMITS</Text></View></View>}
          </View>}
          <View style={{ gap: 12, marginBottom: 18 }}>
            <FlowRow>{languageIds.map(language => <Button key={language} label={languages[language].label} variant={drafts.library.language === language ? 'primary' : 'secondary'} onPress={() => drafts.setLanguage(language)} disabled={!drafts.ready} />)}<Button label="Focus editor" disabled={!drafts.ready} onPress={() => { void toggleFocus(); }} variant="ghost" /></FlowRow>
            <FlowRow><Button label="A−" accessibilityLabel="Decrease code font size" disabled={drafts.library.fontSize <= 16 || !drafts.ready} onPress={() => drafts.configure({ fontSize: Math.max(16, drafts.library.fontSize - 1) })} /><Text style={common.muted}>{drafts.library.fontSize}px code</Text><Button label="A+" accessibilityLabel="Increase code font size" disabled={drafts.library.fontSize >= 26 || !drafts.ready} onPress={() => drafts.configure({ fontSize: drafts.library.fontSize + 1 })} /><Button label="Use as entry" disabled={!drafts.ready || drafts.library.entries[drafts.library.language] === file.id} onPress={() => drafts.setEntry(file.id)} /><Button label="Delete file" disabled={!drafts.ready || drafts.library.files.filter(item => item.language === drafts.library.language).length < 2} onPress={() => { setHelpVisible(false); setRunError('To delete this file, use the confirmation below.'); }} /></FlowRow>
          </View>

          <View style={[styles.workspace, { flexDirection: desktop ? 'row' : 'column' }]}>
            {desktop && <View style={styles.sidebar}><FilesPanel onNew={() => setNameMode('new')} /></View>}
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={[styles.editorHeader, compact && { paddingHorizontal: 12, gap: 6 }]}>
                <View style={[common.row, { flex: 1, minWidth: 0, gap: 8 }]}>
                  {!desktop && <Button label="Files" icon="folder" compact onPress={() => setFilesVisible(true)} />}
                  <View style={[styles.pythonMark, compact && { display: 'none' }]}><Text style={styles.pythonMarkText}>{drafts.library.language === 'python' ? 'py' : drafts.library.language}</Text></View>
                  <Text numberOfLines={1} style={[common.text, { fontSize: 12, flexShrink: 1 }]}>{file.name}</Text>
                  {drafts.status === 'unsaved' && <View accessibilityLabel="Unsaved changes" style={styles.unsavedDot} />}
                  {!compact && <Button label="Rename" compact variant="ghost" onPress={() => setNameMode('rename')} disabled={!drafts.ready} />}
                </View>
                <Button label="Save" icon="save" compact onPress={() => { void save(); }} disabled={!drafts.ready || drafts.status === 'saving'} />
                <Button label={submitting ? 'Sending…' : 'Run'} icon="play" variant="primary" compact disabled={!drafts.ready || submitting || activeRun} onPress={() => { void run(); }} />
              </View>
              {compact && <View style={styles.mobileFileBar}><Text style={styles.micro}>LOCAL DRAFT</Text><Button label="Rename file" icon="edit-2" variant="ghost" compact onPress={() => setNameMode('rename')} disabled={!drafts.ready} /></View>}
              <View style={{ flexDirection: splitConsole ? 'row' : 'column' }}>
                <View style={{ flex: splitConsole ? 1 : undefined, minWidth: 0, height: Math.max(focusEditor ? 480 : 400, Math.min(900, height * (focusEditor ? 0.82 : 0.65))) }}>
                  {editorView}
                </View>
                <View style={[styles.console, splitConsole ? { width: 370, borderLeftWidth: 1, maxHeight: 900 } : { minHeight: 260, maxHeight: 600, borderTopWidth: 1 }]}>
                  <View style={styles.consoleHeader}><View style={[common.row, { gap: 8 }]}><Icon name="terminal" size={14} /><Text style={styles.consoleTitle}>Output</Text></View><Button label="Clear" accessibilityLabel="Clear execution output" variant="ghost" compact disabled={(activeRun && !live.error) || submitting} onPress={() => { setExecutionId(null); setRunError(''); }} /></View>
                  <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, flexGrow: 1 }}>
                    {executionId ? <View style={{ gap: 12 }}><ResourceState resource={live} />{runData && <RunOutput data={runData} />}<Button label="Full execution details" href={{ pathname: '/execution', params: { id: executionId } }} />{activeRun && <Button label={cancelling ? 'Requesting cancellation…' : 'Cancel execution'} disabled={cancelling} onPress={() => { void cancel(); }} />}</View> : <View style={{ flex: 1, justifyContent: 'center', gap: 12 }}>
                      <View style={styles.terminalMark}><Icon name="terminal" size={20} color={colors.cyan} /></View>
                      <Text style={[common.text, { fontSize: 13 }]}>Room for a little discovery.</Text>
                      <Text style={[common.muted, { fontSize: 15 }]}>{auth.me ? 'Run your code to see output, status, and metrics here.' : 'Guests can edit and save drafts. Sign in to execute code.'}</Text>
                      {!auth.me && <Button label="Sign in to run" href="/login" />}
                    </View>}
                  </ScrollView>
                  <View style={styles.runtime}><View style={styles.tinyDot} /><Text style={styles.runtimeText}>{auth.me ? 'AUTHENTICATED API · FOCUS POLLING' : 'DEVICE DRAFTS · SIGN IN TO RUN'}</Text><Icon name="server" size={11} /></View>
                </View>
              </View>
              <View style={styles.statusBar}>
                <View style={[common.row, { gap: 6 }]}><Icon name={drafts.status === 'saved' ? 'check-circle' : drafts.status === 'error' ? 'alert-circle' : 'hard-drive'} size={11} color={drafts.status === 'error' ? colors.error : colors.muted} /><Text accessibilityLiveRegion="polite" style={styles.status}>{statusText}</Text></View>
                <Pressable accessibilityRole="button" accessibilityLabel="Editor keyboard shortcuts and tips" onPress={() => setHelpVisible(true)} style={styles.helpButton}><Icon name="command" size={11} /><Text style={styles.status}>{compact ? 'Tips' : 'Keyboard & tips'}</Text></Pressable>
              </View>
            </View>
          </View>
          {!!runError && <View style={{ gap: 10, marginTop: 14 }}><Notice>{runError}</Notice>{runError.startsWith('To delete') && <FlowRow><Button label={`Confirm delete ${file.name}`} onPress={() => { try { drafts.remove(file.id); setRunError(''); } catch (err) { setRunError(describeError(err)); } }} /><Button label="Keep file" onPress={() => setRunError('')} /></FlowRow>}</View>}
          {auth.error && <Notice>{auth.error}</Notice>}
          <View style={{ gap: 14, marginTop: 20, padding: 18, borderRadius: 18, borderWidth: 1, borderColor: colors.border }}>
            <Text style={common.eyebrow}>RUN CONFIGURATION · ENTRY: {drafts.library.files.find(item => item.id === drafts.library.entries[drafts.library.language])?.name ?? file.name}</Text>
            <Field label="Standard input" multiline value={drafts.library.stdin} onChangeText={stdin => drafts.configure({ stdin })} editable={drafts.ready} style={{ minHeight: 100, textAlignVertical: 'top', fontFamily: mono }} placeholder="Input provided to your program (not an interactive terminal)" />
            <FlowRow><Field label={`Timeout ms (max ${Math.min(auth.me?.limits.maxTimeoutMs ?? 10000, 10000)})`} value={String(drafts.library.timeoutMs)} keyboardType="number-pad" editable={drafts.ready} onChangeText={value => { if (/^\d+$/.test(value) && Number(value) > 0) drafts.configure({ timeoutMs: Math.min(Number(value), 10000) }); }} /><Field label={`Memory MiB (max ${Math.min(auth.me?.limits.maxMemoryMb ?? 512, 512)})`} value={String(drafts.library.memoryMb)} keyboardType="number-pad" editable={drafts.ready} onChangeText={value => { if (/^\d+$/.test(value) && Number(value) > 0) drafts.configure({ memoryMb: Math.min(Number(value), 512) }); }} /></FlowRow>
            <Text style={common.muted}>Tenant limits are applied when submitting. Only this language’s files are sent. Switching languages keeps all your drafts. No packages are installed by the editor.</Text>
          </View>
          {drafts.error && <View style={{ marginTop: 14, gap: 8 }}><Notice>{drafts.error}</Notice>{!drafts.ready && <Button label="Retry opening drafts" onPress={drafts.retry} />}</View>}

          <View style={[styles.footer, compact && { alignItems: 'flex-start', gap: 14, flexDirection: 'column' }]}>
            <View style={common.row}><Icon name="code" size={13} color={colors.accent} /><Text style={styles.footerText}>A blank canvas. A whole universe.</Text></View>
            <Text style={styles.footerText}>BUILT FOR THE WAY YOU THINK <Text style={{ color: colors.accent }}> / </Text> GIGACODE</Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>

    {nameMode && <FileNameModal mode={nameMode} initialName={nameMode === 'rename' ? file.name : ''} onClose={() => setNameMode(null)} onConfirm={nameMode === 'new' ? drafts.create : drafts.rename} />}
    <Modal visible={filesVisible} transparent animationType="slide" onRequestClose={() => setFilesVisible(false)}>
      <View style={styles.modalBackdrop}><Pressable style={StyleSheet.absoluteFill} onPress={() => setFilesVisible(false)} accessibilityLabel="Close files" /><SafeAreaView accessibilityViewIsModal style={styles.filesSheet}><View style={styles.sheetHeader}><Text style={common.eyebrow}>YOUR WORKSPACE</Text><Button label="Done" variant="ghost" onPress={() => setFilesVisible(false)} /></View><FilesPanel onNew={() => { setFilesVisible(false); setNameMode('new'); }} onOpen={() => setFilesVisible(false)} /></SafeAreaView></View>
    </Modal>
    <Modal visible={helpVisible} transparent animationType="fade" onRequestClose={() => setHelpVisible(false)}>
      <View style={[styles.modalBackdrop, { justifyContent: 'center', alignItems: 'center', padding: 22 }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setHelpVisible(false)} accessibilityLabel="Close editor tips" />
        <View accessibilityViewIsModal style={styles.helpPanel}>
          <Pill label="A FEW LITTLE SHORTCUTS" />
          <Text style={[styles.heading, { fontSize: 28, lineHeight: 34, marginBottom: 20 }]}>Stay in your flow.</Text>
          {[['⌘ / Ctrl + Enter', 'Submit a sandbox run'], ['⌘ / Ctrl + S', 'Save on this device'], ['Ctrl + Space', 'Open language suggestions'], ['Tab / Next field', 'Indent or advance a snippet'], ['↑ ↓ · Enter · Esc', 'Navigate, accept, dismiss']].map(([key, description]) => <View key={key} style={styles.shortcut}><Text style={{ color: colors.accent, fontFamily: mono, fontSize: 12 }}>{key}</Text><Text style={common.muted}>{description}</Text></View>)}
          <Text style={[common.muted, { marginTop: 16, marginBottom: 22 }]}>On touch screens, tap Suggest in the editor and tap a completion. Start with “pri” to discover print. Local saves do not require an account.</Text>
          <Button label="Back to creating" variant="primary" onPress={() => setHelpVisible(false)} />
        </View>
      </View>
    </Modal>
  </SafeAreaView>;
}

const createStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  page: { width: '100%', maxWidth: 1480, alignSelf: 'center', paddingHorizontal: 44 },
  header: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'center', paddingVertical: 22, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerDivider: { width: 1, height: 17, backgroundColor: colors.strongBorder, marginHorizontal: 9 },
  headerLabel: { color: colors.faint, fontFamily: font.medium, fontSize: 9, letterSpacing: 2 },
  hero: { paddingTop: 42, paddingBottom: 40, flexDirection: 'row', position: 'relative', minHeight: 300 },
  heading: { fontFamily: font.medium, color: colors.text, fontSize: 58, lineHeight: 63, letterSpacing: -2.6, marginTop: 20 },
  heroOrbit: { position: 'absolute', right: 28, top: -14, alignItems: 'center' },
  orbitCaption: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: -20 },
  orbitLabel: { color: colors.faint, fontFamily: font.regular, fontSize: 8, letterSpacing: 2 },
  tinyDot: { width: 4, height: 4, backgroundColor: colors.cyan, borderRadius: 4 },
  workspace: { borderWidth: 1, borderColor: colors.strongBorder, borderRadius: 22, overflow: 'hidden', backgroundColor: colors.panel, boxShadow: `0 20px 70px -20px ${colors.shadow}, 0 0 40px ${colors.glow}` },
  sidebar: { width: 246, borderRightWidth: 1, borderRightColor: colors.border },
  editorHeader: { height: 65, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.raised },
  pythonMark: { backgroundColor: colors.accentSoft, width: 25, height: 25, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  pythonMarkText: { color: colors.accent, fontFamily: mono, fontSize: 11 },
  unsavedDot: { width: 5, height: 5, borderRadius: 5, backgroundColor: colors.warning },
  mobileFileBar: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingLeft: 16, paddingRight: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  micro: { color: colors.faint, fontFamily: font.medium, fontSize: 9, letterSpacing: 1.5 },
  console: { backgroundColor: colors.console, borderColor: colors.border },
  consoleHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 19, minHeight: 48, borderBottomWidth: 1, borderBottomColor: colors.border },
  consoleTitle: { color: colors.muted, fontFamily: font.medium, fontSize: 12 },
  consoleText: { color: colors.muted, fontFamily: mono, fontSize: 11, lineHeight: 19 },
  terminalMark: { height: 36, width: 36, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.border, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  runtime: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 20, paddingVertical: 13, borderTopWidth: 1, borderTopColor: colors.border },
  runtimeText: { flex: 1, color: colors.warning, fontFamily: mono, fontSize: 9, letterSpacing: 1 },
  statusBar: { paddingHorizontal: 16, minHeight: 36, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.border },
  status: { color: colors.muted, fontFamily: font.regular, fontSize: 10 },
  helpButton: { flexDirection: 'row', gap: 6, alignItems: 'center', minHeight: 36, paddingLeft: 8 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 23, paddingBottom: 32 },
  footerText: { fontFamily: font.regular, fontSize: 9, color: colors.faint, letterSpacing: 0.8 },
  modalBackdrop: { flex: 1, backgroundColor: colors.backdrop, justifyContent: 'flex-end' },
  filesSheet: { backgroundColor: colors.console, height: '80%', borderTopWidth: 1, borderColor: colors.strongBorder, borderTopLeftRadius: 22, borderTopRightRadius: 22, overflow: 'hidden' },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingLeft: 24, paddingRight: 10, paddingTop: 10 },
  helpPanel: { backgroundColor: colors.panel, borderRadius: 22, borderWidth: 1, borderColor: colors.strongBorder, padding: 28, width: '100%', maxWidth: 460 },
  shortcut: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 4 },
});
