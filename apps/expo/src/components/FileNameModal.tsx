import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from './ui';
import { font, type Colors } from '@/theme';
import { useStyles, useTheme } from '@/state/ThemeProvider';

export function FileNameModal({ mode, initialName, onClose, onConfirm }: { mode: 'new' | 'rename'; initialName: string; onClose: () => void; onConfirm: (name: string) => void }) {
  const { colors, common } = useTheme();
  const styles = useStyles(createStyles);
  const [name, setName] = useState(initialName);
  const [error, setError] = useState('');
  const submit = () => {
    try { onConfirm(name); onClose(); } catch (err) { setError(err instanceof Error ? err.message : 'Could not update file.'); }
  };
  return <Modal transparent animationType="fade" onRequestClose={onClose}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close file dialog" />
      <View accessibilityViewIsModal style={styles.panel}>
        <Text accessibilityRole="header" style={styles.title}>{mode === 'new' ? 'A new possibility.' : 'Give it a new name.'}</Text>
        <Text style={common.muted}>Saved privately on this device. Add .py or we will.</Text>
        <Text style={[common.eyebrow, { marginTop: 24 }]}>FILE NAME</Text>
        <TextInput autoFocus accessibilityLabel="File name" autoCapitalize="none" autoCorrect={false} value={name} onChangeText={setName} onSubmitEditing={submit} maxLength={64} placeholder="my_next_idea.py" placeholderTextColor={colors.faint} style={styles.input} />
        {!!error && <Text accessibilityRole="alert" style={{ color: colors.error, fontFamily: font.regular, fontSize: 12 }}>{error}</Text>}
        <View style={[common.row, { justifyContent: 'flex-end', marginTop: 22 }]}><Button label="Cancel" onPress={onClose} variant="ghost" /><Button label={mode === 'new' ? 'Create file' : 'Rename file'} variant="primary" onPress={submit} /></View>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}
const createStyles = (colors: Colors) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.backdrop, justifyContent: 'center', alignItems: 'center', padding: 20 },
  panel: { width: '100%', maxWidth: 440, padding: 28, backgroundColor: colors.panel, borderColor: colors.strongBorder, borderWidth: 1, borderRadius: 22 },
  title: { fontFamily: font.medium, fontSize: 24, color: colors.text, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: colors.strongBorder, borderRadius: 12, backgroundColor: colors.editor, color: colors.text, padding: 14, marginVertical: 12, fontFamily: font.regular, fontSize: 14 },
});
