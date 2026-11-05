import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button } from './ui';
import { font, mono, radius, type Colors } from '@/theme';
import { useStyles, useTheme } from '@/state/ThemeProvider';
import { useDrafts } from '@/state/DraftProvider';
import { languages } from '@/lib/languages';

export function FileNameModal({
  mode,
  initialName,
  onClose,
  onConfirm,
}: {
  mode: 'new' | 'rename';
  initialName: string;
  onClose: () => void;
  onConfirm: (name: string) => void;
}) {
  const { colors, common } = useTheme();
  const styles = useStyles(createStyles);
  const { library } = useDrafts();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState('');
  const submit = () => {
    try {
      onConfirm(name);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update file.');
    }
  };
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close file dialog" />
        <ScrollView accessibilityViewIsModal keyboardShouldPersistTaps="handled" style={styles.panel} contentContainerStyle={{ padding: 20 }}>
          <Text accessibilityRole="header" style={styles.title}>
            {mode === 'new' ? 'New file' : 'Rename file'}
          </Text>
          <Text style={common.muted}>
            Saved on this device. Default extension: {languages[library.language].extension}. Files for each
            language are kept separately.
          </Text>
          <Text style={[common.eyebrow, { marginTop: 24 }]}>FILE NAME</Text>
          <TextInput
            autoFocus
            accessibilityLabel="File name"
            autoCapitalize="none"
            autoCorrect={false}
            value={name}
            onChangeText={setName}
            onSubmitEditing={submit}
            maxLength={64}
            placeholder={languages[library.language].entry}
            placeholderTextColor={colors.faint}
            selectionColor={colors.selection}
            style={styles.input}
          />
          {!!error && (
            <Text
              accessibilityRole="alert"
              style={{ color: colors.error, fontFamily: font.regular, fontSize: 12 }}
            >
              {error}
            </Text>
          )}
          <View style={[common.row, { justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 22 }]}>
            <Button label="Cancel" onPress={onClose} variant="ghost" />
            <Button
              label={mode === 'new' ? 'Create file' : 'Rename file'}
              variant="primary"
              onPress={submit}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
const createStyles = (colors: Colors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: colors.backdrop,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
    },
    panel: {
      width: '100%',
      maxWidth: 440,
      maxHeight: '90%',
      flexGrow: 0,
      backgroundColor: colors.panel,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: radius,
      boxShadow: `0 2px 8px ${colors.shadow}`,
    },
    title: { fontFamily: font.semibold, fontSize: 20, color: colors.text, marginBottom: 8 },
    input: {
      borderWidth: 1,
      borderColor: colors.strongBorder,
      borderRadius: radius,
      backgroundColor: colors.panel,
      color: colors.text,
      padding: 14,
      marginVertical: 12,
      fontFamily: mono,
      fontSize: 16,
    },
  });
