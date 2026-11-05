import { useRef, useState } from 'react';
import { Stack } from 'expo-router';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Icon, Notice, Pill } from '@/components/ui';
import { FilesPanel } from '@/components/FilesPanel';
import { FileNameModal } from '@/components/FileNameModal';
import CodeEditor from '@/components/CodeEditor';
import { useEditorBridge } from '@/lib/useEditorBridge';
import { FlowRow, ResourceState } from '@/components/AppScreen';
import { AppShell, useContentWidth } from '@/components/AppShell';
import { RunOutput } from '@/components/RunOutput';
import { RunSettings } from '@/components/RunSettings';
import { useAuth } from '@/state/AuthProvider';
import { describeError } from '@/lib/client';
import { executionSource } from '@/lib/drafts';
import { languageIds, languages } from '@/lib/languages';
import { useLiveRun } from '@/lib/useResource';
import { terminal } from '@/lib/types';
import { plainEditorPalettes } from '@/lib/palette';
import { useDrafts } from '@/state/DraftProvider';
import { font, mono, radius, type Colors } from '@/theme';
import { useStyles, useTheme } from '@/state/ThemeProvider';

export default function Workspace() {
  const auth = useAuth();
  return <WorkspaceContent key={`${auth.baseUrl}:${auth.me?.user.id ?? 'guest'}`} />;
}

function WorkspaceContent() {
  const { colors, common, mode } = useTheme();
  const styles = useStyles(createStyles);
  const width = useContentWidth();
  const desktop = width >= 960;
  const compact = width < 600;
  const nativeEditor = Platform.OS === 'android' || Platform.OS === 'ios';
  const editorColors = plainEditorPalettes[mode];
  const drafts = useDrafts();
  const auth = useAuth();
  const file =
    drafts.library.files.find((item) => item.id === drafts.library.activeId) ?? drafts.library.files[0];
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
    if (!auth.me) {
      setRunError('Sign in to execute code. Your local drafts are preserved.');
      return;
    }
    if (submitLock.current || activeRun || !drafts.ready) return;
    submitLock.current = true;
    setSubmitting(true);
    setRunError('');
    try {
      if (id && code !== undefined) drafts.edit(id, code);
      else await syncEditor();
      const source = executionSource(drafts.snapshot(), auth.me.limits);
      const response = await auth.api.request<{ id: string }>('POST', '/v1/executions', { body: source });
      setExecutionId(response.id);
    } catch (err) {
      setRunError(describeError(err));
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  };
  const syncEditor = async () => {
    const latest = await readDocument();
    drafts.edit(latest.fileId, latest.code);
  };
  const save = async () => {
    try {
      await syncEditor();
      await drafts.save();
    } catch (err) {
      setRunError(describeError(err));
    }
  };
  const toggleFocus = async () => {
    try {
      await syncEditor();
      setFocusEditor((value) => !value);
    } catch (err) {
      setRunError(describeError(err));
    }
  };
  const cancel = async () => {
    if (!executionId) return;
    setCancelling(true);
    setRunError('');
    try {
      await auth.api.request('POST', `/v1/executions/${encodeURIComponent(executionId)}/cancel`);
      live.reload();
    } catch (err) {
      setRunError(describeError(err));
    } finally {
      setCancelling(false);
    }
  };
  const saveFromEditor = async (id: string, code: string) => {
    drafts.edit(id, code);
    await drafts.save();
  };
  const statusText = {
    loading: 'Opening device drafts…',
    saved: 'Saved on device',
    unsaved: 'Unsaved changes',
    saving: 'Saving on device…',
    error: 'Storage needs attention',
  }[drafts.status];
  const editorView = drafts.ready ? (
    <CodeEditor
      ref={editor}
      key={file.id}
      fileId={file.id}
      code={file.code}
      readOnly={false}
      mode={mode}
      language={drafts.library.language}
      fontSize={drafts.library.fontSize}
      onChange={async (id, code) => drafts.edit(id, code)}
      onSave={saveFromEditor}
      onRun={run}
      onDocument={onDocument}
      dom={{
        matchContents: true,
        containerStyle: { width: '100%', backgroundColor: editorColors.background },
        style: { width: '100%', backgroundColor: editorColors.background },
        scrollEnabled: false,
        nestedScrollEnabled: false,
        showsVerticalScrollIndicator: false,
        showsHorizontalScrollIndicator: false,
      }}
    />
  ) : (
    <Text style={common.muted}>Opening device drafts…</Text>
  );

  return (
    <AppShell title="Workspace">
      <Stack.Screen options={{ title: 'Workspace — GigaCode' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={[styles.page, compact && { paddingHorizontal: 16 }]}>
            {!focusEditor && (
              <View style={styles.hero}>
                <Text accessibilityRole="header" style={styles.heading}>Your code playground</Text>
                <Text style={[common.muted, { marginTop: 8, maxWidth: 640, fontSize: 14 }]}>
                  Write Python, Node.js, C or C++. Run in an isolated sandbox with clear limits and readable results.
                </Text>
              </View>
            )}
            <View style={{ gap: 12, marginBottom: 18 }}>
              <FlowRow>
                {languageIds.map((language) => (
                  <Button
                    key={language}
                    label={languages[language].label}
                    variant={drafts.library.language === language ? 'primary' : 'secondary'}
                    onPress={() => drafts.setLanguage(language)}
                    disabled={!drafts.ready}
                  />
                ))}
                <Button
                  label={focusEditor ? 'Show introduction' : 'Focus editor'}
                  disabled={!drafts.ready}
                  onPress={() => {
                    void toggleFocus();
                  }}
                  variant="ghost"
                />
              </FlowRow>
              <FlowRow>
                <Button
                  label="A−"
                  accessibilityLabel="Decrease code font size"
                  disabled={drafts.library.fontSize <= 8 || !drafts.ready}
                  onPress={() => drafts.configure({ fontSize: Math.max(8, drafts.library.fontSize - 1) })}
                />
                <Text style={common.muted}>{drafts.library.fontSize}px code</Text>
                <Button
                  label="A+"
                  accessibilityLabel="Increase code font size"
                  disabled={drafts.library.fontSize >= 26 || !drafts.ready}
                  onPress={() => drafts.configure({ fontSize: drafts.library.fontSize + 1 })}
                />
                <Button
                  label="Use as entry"
                  disabled={!drafts.ready || drafts.library.entries[drafts.library.language] === file.id}
                  onPress={() => drafts.setEntry(file.id)}
                />
                <Button
                  label="Delete file"
                  disabled={
                    !drafts.ready ||
                    drafts.library.files.filter((item) => item.language === drafts.library.language).length <
                      2
                  }
                  onPress={() => {
                    setHelpVisible(false);
                    setRunError('To delete this file, use the confirmation below.');
                  }}
                />
              </FlowRow>
            </View>

            <View
              style={[
                styles.workspace,
                {
                  flexDirection: desktop ? 'row' : 'column',
                  backgroundColor: editorColors.background,
                  borderColor: editorColors.border,
                },
              ]}
            >
              {desktop && (
                <View style={[styles.sidebar, { borderRightColor: editorColors.border }]}>
                  <FilesPanel onNew={() => setNameMode('new')} />
                </View>
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <View
                  style={[
                    styles.editorHeader,
                    compact && { paddingHorizontal: 12, gap: 6 },
                    nativeEditor && styles.plainEditorHeader,
                    { backgroundColor: editorColors.background, borderBottomColor: editorColors.border },
                  ]}
                >
                  <View style={[common.row, { flex: 1, minWidth: 0, gap: 8 }, compact && { flexBasis: '100%' }]}>
                    {!desktop && (
                      <Button label="Files" icon="folder" compact onPress={() => setFilesVisible(true)} />
                    )}
                    {!nativeEditor && (
                      <View style={[styles.pythonMark, compact && { display: 'none' }]}>
                        <Text style={styles.pythonMarkText}>
                          {drafts.library.language === 'python' ? 'py' : drafts.library.language}
                        </Text>
                      </View>
                    )}
                    <Text
                      numberOfLines={1}
                      style={[common.text, { fontSize: 12, flexShrink: 1, color: editorColors.text }]}
                    >
                      {file.name}
                    </Text>
                    {drafts.status === 'unsaved' && (
                      <View accessibilityLabel="Unsaved changes" style={styles.unsavedDot} />
                    )}
                    {!compact && (
                      <Button
                        label="Rename"
                        compact
                        variant="ghost"
                        onPress={() => setNameMode('rename')}
                        disabled={!drafts.ready}
                      />
                    )}
                  </View>
                  <Button
                    label="Save"
                    icon="save"
                    compact
                    onPress={() => {
                      void save();
                    }}
                    disabled={!drafts.ready || drafts.status === 'saving'}
                  />
                  <Button
                    label={submitting ? 'Sending…' : 'Run'}
                    icon="play"
                    variant="primary"
                    compact
                    disabled={!drafts.ready || submitting || activeRun}
                    onPress={() => {
                      void run();
                    }}
                  />
                </View>
                {compact && (
                  <View
                    style={[
                      styles.mobileFileBar,
                      { borderBottomColor: editorColors.border },
                      nativeEditor && { justifyContent: 'flex-end' },
                    ]}
                  >
                    {!nativeEditor && <Text style={styles.micro}>LOCAL DRAFT</Text>}
                    <Button
                      label="Rename file"
                      icon="edit-2"
                      variant="ghost"
                      compact
                      onPress={() => setNameMode('rename')}
                      disabled={!drafts.ready}
                    />
                  </View>
                )}
                <View>
                  <View style={{ minWidth: 0 }}>{editorView}</View>
                  <View
                    style={[
                      styles.console,
                      {
                        borderTopWidth: 1,
                        backgroundColor: editorColors.background,
                        borderColor: editorColors.border,
                      },
                    ]}
                  >
                    <View style={[styles.consoleHeader, { borderBottomColor: editorColors.border }]}>
                      <View style={[common.row, { gap: 8 }]}>
                        <Icon name="terminal" size={14} />
                        <Text style={[styles.consoleTitle, { color: editorColors.muted }]}>Output</Text>
                      </View>
                      <Button
                        label="Clear"
                        accessibilityLabel="Clear execution output"
                        variant="ghost"
                        compact
                        disabled={(activeRun && !live.error) || submitting}
                        onPress={() => {
                          setExecutionId(null);
                          setRunError('');
                        }}
                      />
                    </View>
                    <View style={{ padding: 20 }}>
                      {executionId ? (
                        <View style={{ gap: 12 }}>
                          <ResourceState resource={live} />
                          {runData && <RunOutput data={runData} />}
                          <Button
                            label="Full execution details"
                            href={{ pathname: '/execution', params: { id: executionId } }}
                          />
                          {activeRun && (
                            <Button
                              label={cancelling ? 'Requesting cancellation…' : 'Cancel execution'}
                              disabled={cancelling}
                              onPress={() => {
                                void cancel();
                              }}
                            />
                          )}
                        </View>
                      ) : (
                        <View style={{ flex: 1, justifyContent: 'center', gap: 12 }}>
                          <View style={styles.terminalMark}>
                            <Icon name="terminal" size={20} color={colors.muted} />
                          </View>
                          <Text style={[common.text, { fontFamily: font.medium }]}>Ready when you are.</Text>
                          <Text style={[common.muted, { fontSize: 15 }]}>
                            {auth.me
                              ? 'Run your code to see output, status, and metrics here.'
                              : 'Guests can edit and save drafts. Sign in to execute code.'}
                          </Text>
                          {!auth.me && <Button label="Sign in to run" href="/login" />}
                        </View>
                      )}
                    </View>
                    <View style={[styles.runtime, { borderTopColor: editorColors.border }]}>
                      <View style={styles.tinyDot} />
                      <Text style={styles.runtimeText}>
                        {auth.me ? 'Connected · Status updates while focused' : 'Device drafts · Sign in to run'}
                      </Text>
                      <Icon name="server" size={11} />
                    </View>
                  </View>
                </View>
                <View style={[styles.statusBar, { borderTopColor: editorColors.border }]}>
                  <View style={[common.row, { gap: 6 }]}>
                    <Icon
                      name={
                        drafts.status === 'saved'
                          ? 'check-circle'
                          : drafts.status === 'error'
                            ? 'alert-circle'
                            : 'hard-drive'
                      }
                      size={11}
                      color={drafts.status === 'error' ? colors.error : colors.muted}
                    />
                    <Text accessibilityLiveRegion="polite" style={styles.status}>
                      {statusText}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Editor keyboard shortcuts and tips"
                    onPress={() => setHelpVisible(true)}
                    style={styles.helpButton}
                  >
                    <Icon name="command" size={11} />
                    <Text style={styles.status}>{compact ? 'Tips' : 'Keyboard & tips'}</Text>
                  </Pressable>
                </View>
              </View>
            </View>
            {!!runError && (
              <View style={{ gap: 10, marginTop: 14 }}>
                <Notice>{runError}</Notice>
                {runError.startsWith('To delete') && (
                  <FlowRow>
                    <Button
                      label={`Confirm delete ${file.name}`}
                      variant="danger"
                      onPress={() => {
                        try {
                          drafts.remove(file.id);
                          setRunError('');
                        } catch (err) {
                          setRunError(describeError(err));
                        }
                      }}
                    />
                    <Button label="Keep file" onPress={() => setRunError('')} />
                  </FlowRow>
                )}
              </View>
            )}
            {auth.error && <Notice>{auth.error}</Notice>}
            <View style={{ marginTop: 20 }}>
              <RunSettings />
            </View>
            {drafts.error && (
              <View style={{ marginTop: 14, gap: 8 }}>
                <Notice>{drafts.error}</Notice>
                {!drafts.ready && <Button label="Retry opening drafts" onPress={drafts.retry} />}
              </View>
            )}

            <View
              style={[
                styles.footer,
                compact && { alignItems: 'flex-start', gap: 14, flexDirection: 'column' },
              ]}
            >
              <View style={common.row}>
                <Icon name="code" size={13} color={colors.accent} />
                <Text style={styles.footerText}>Local drafts. Isolated execution.</Text>
              </View>
              <Text style={styles.footerText}>
                GigaCode
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {nameMode && (
        <FileNameModal
          mode={nameMode}
          initialName={nameMode === 'rename' ? file.name : ''}
          onClose={() => setNameMode(null)}
          onConfirm={nameMode === 'new' ? drafts.create : drafts.rename}
        />
      )}
      <Modal
        visible={filesVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setFilesVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setFilesVisible(false)}
            accessibilityLabel="Close files"
          />
          <SafeAreaView accessibilityViewIsModal style={styles.filesSheet}>
            <View style={styles.sheetHeader}>
              <Text style={common.eyebrow}>YOUR WORKSPACE</Text>
              <Button label="Done" variant="ghost" onPress={() => setFilesVisible(false)} />
            </View>
            <FilesPanel
              onNew={() => {
                setFilesVisible(false);
                setNameMode('new');
              }}
              onOpen={() => setFilesVisible(false)}
            />
          </SafeAreaView>
        </View>
      </Modal>
      <Modal
        visible={helpVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setHelpVisible(false)}
      >
        <View style={[styles.modalBackdrop, { justifyContent: 'center', alignItems: 'center', padding: 22 }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setHelpVisible(false)}
            accessibilityLabel="Close editor tips"
          />
          <ScrollView
            accessibilityViewIsModal
            keyboardShouldPersistTaps="handled"
            style={styles.helpPanel}
            contentContainerStyle={{ padding: 20 }}
          >
            <Pill label="A FEW LITTLE SHORTCUTS" />
            <Text style={[styles.heading, { fontSize: 24, lineHeight: 32, marginBottom: 20, marginTop: 16 }]}>
              Keyboard shortcuts
            </Text>
            {[
              ['⌘ / Ctrl + Enter', 'Submit a sandbox run'],
              ['⌘ / Ctrl + S', 'Save on this device'],
              ['Ctrl + Space', 'Open language suggestions'],
              ['Tab / Next field', 'Indent or advance a snippet'],
              ['↑ ↓ · Enter · Esc', 'Navigate, accept, dismiss'],
            ].map(([key, description]) => (
              <View key={key} style={styles.shortcut}>
                <Text style={{ color: colors.accent, fontFamily: mono, fontSize: 12 }}>{key}</Text>
                <Text style={common.muted}>{description}</Text>
              </View>
            ))}
            <Text style={[common.muted, { marginTop: 16, marginBottom: 22 }]}>
              Suggestions appear as you type; tap a completion to insert it. Start with “pri” to discover
              print. The editor expands with your code, and the whole page scrolls together. Local saves do
              not require an account.
            </Text>
            <Button label="Back to creating" variant="primary" onPress={() => setHelpVisible(false)} />
          </ScrollView>
        </View>
      </Modal>
    </AppShell>
  );
}

const createStyles = (colors: Colors) =>
  StyleSheet.create({
    page: { width: '100%', maxWidth: 1480, alignSelf: 'center', paddingHorizontal: 32, paddingTop: 24 },
    hero: { paddingBottom: 24 },
    heading: {
      fontFamily: font.semibold,
      color: colors.text,
      fontSize: 28,
      lineHeight: 36,
      letterSpacing: -0.7,
    },
    tinyDot: { width: 4, height: 4, backgroundColor: colors.muted, borderRadius: 4 },
    workspace: { borderWidth: 1, borderRadius: radius, overflow: 'hidden' },
    sidebar: { width: 224, borderRightWidth: 1, borderRightColor: colors.border },
    editorHeader: {
      minHeight: 56,
      paddingHorizontal: 12,
      paddingVertical: 6,
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.raised,
    },
    plainEditorHeader: { height: 'auto', minHeight: 48, paddingHorizontal: 8, paddingVertical: 4 },
    pythonMark: {
      backgroundColor: colors.accentSoft,
      width: 25,
      height: 25,
      borderRadius: 6,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pythonMarkText: { color: colors.accent, fontFamily: mono, fontSize: 11 },
    unsavedDot: { width: 5, height: 5, borderRadius: 5, backgroundColor: colors.warning },
    mobileFileBar: {
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      paddingLeft: 16,
      paddingRight: 4,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    micro: { color: colors.faint, fontFamily: font.medium, fontSize: 9, letterSpacing: 1.5 },
    console: { backgroundColor: colors.console, borderColor: colors.border },
    consoleHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 19,
      minHeight: 48,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    consoleTitle: { color: colors.muted, fontFamily: font.medium, fontSize: 12 },
    consoleText: { color: colors.muted, fontFamily: mono, fontSize: 11, lineHeight: 19 },
    terminalMark: {
      height: 36,
      width: 36,
      backgroundColor: colors.accentSoft,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    runtime: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      paddingHorizontal: 20,
      paddingVertical: 13,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    runtimeText: { flex: 1, color: colors.muted, fontFamily: font.regular, fontSize: 11 },
    statusBar: {
      paddingHorizontal: 16,
      minHeight: 44,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    status: { color: colors.muted, fontFamily: font.regular, fontSize: 10 },
    helpButton: { flexDirection: 'row', gap: 6, alignItems: 'center', minHeight: 44, paddingLeft: 8 },
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingTop: 23,
      paddingBottom: 32,
    },
    footerText: { fontFamily: font.regular, fontSize: 11, color: colors.muted },
    modalBackdrop: { flex: 1, backgroundColor: colors.backdrop, justifyContent: 'flex-end' },
    filesSheet: {
      backgroundColor: colors.console,
      height: '80%',
      borderTopWidth: 1,
      borderColor: colors.border,
      borderTopLeftRadius: radius,
      borderTopRightRadius: radius,
      overflow: 'hidden',
    },
    sheetHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingLeft: 24,
      paddingRight: 10,
      paddingTop: 10,
    },
    helpPanel: {
      backgroundColor: colors.panel,
      borderRadius: radius,
      borderWidth: 1,
      borderColor: colors.border,
      maxHeight: '90%',
      width: '100%',
      maxWidth: 460,
    },
    shortcut: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 4 },
  });
