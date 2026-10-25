import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { useDrafts } from '@/state/DraftProvider';
import { font, type Colors } from '@/theme';
import { useStyles, useTheme } from '@/state/ThemeProvider';
import { Button, Icon } from './ui';

export function FilesPanel({ onNew, onOpen }: { onNew: () => void; onOpen?: () => void }) {
  const { colors, common } = useTheme();
  const styles = useStyles(createStyles);
  const { library, ready, open } = useDrafts();
  return <View style={styles.panel}>
    <View style={[common.row, { justifyContent: 'space-between', marginBottom: 24 }]}><Text style={[common.text, { fontFamily: font.medium }]}>Your files</Text><Icon name="folder" size={16} /></View>
    <Button label="New Python file" icon="plus" onPress={onNew} disabled={!ready} />
    <View style={[common.row, { marginTop: 28, marginBottom: 12, gap: 7 }]}><View style={styles.dot} /><Text style={common.eyebrow}>ON THIS DEVICE</Text></View>
    <ScrollView style={{ flex: 1, minHeight: 100 }} contentContainerStyle={{ gap: 4 }}>
      {library.files.map(file => <Pressable key={file.id} accessibilityRole="button" accessibilityLabel={`Open ${file.name}`} accessibilityState={{ selected: library.activeId === file.id, disabled: !ready }} disabled={!ready}
        onPress={() => { open(file.id); onOpen?.(); }} style={({ pressed }) => [styles.file, (library.activeId === file.id || pressed) && styles.activeFile]}>
        <Icon name="file-text" size={15} color={library.activeId === file.id ? colors.accent : colors.faint} />
        <Text numberOfLines={1} style={[common.text, { flex: 1, fontSize: 12, color: library.activeId === file.id ? colors.text : colors.muted }]}>{file.name}</Text>
        {library.activeId === file.id && <View style={styles.activeDot} />}
      </Pressable>)}
    </ScrollView>
    <View style={styles.cloud}>
      <Icon name="cloud" size={22} color={colors.accent} />
      <Text style={[common.text, { fontFamily: font.medium, marginTop: 14 }]}>Ideas, everywhere.</Text>
      <Text style={[common.muted, { fontSize: 12, marginTop: 7, marginBottom: 15 }]}>Cloud files will live here when accounts are connected. Local drafts stay on this device.</Text>
      <Button label="Sign in for cloud" icon="arrow-up-right" href="/login" compact />
    </View>
    <View style={[common.row, { marginTop: 22, gap: 7 }]}><Icon name="hard-drive" size={12} /><Text style={[common.muted, { fontSize: 10 }]}>Device storage · not cloud synced</Text></View>
  </View>;
}
const createStyles = (colors: Colors) => StyleSheet.create({
  panel: { flex: 1, padding: 20, backgroundColor: colors.console },
  dot: { width: 4, height: 4, borderRadius: 4, backgroundColor: colors.muted },
  file: { minHeight: 43, borderRadius: 7, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 10, borderWidth: 1, borderColor: 'transparent' },
  activeFile: { backgroundColor: colors.accentSoft, borderColor: colors.strongBorder },
  activeDot: { width: 4, height: 4, borderRadius: 4, backgroundColor: colors.accent },
  cloud: { padding: 17, borderWidth: 1, borderColor: colors.border, borderRadius: 16, marginTop: 24, backgroundColor: colors.panel },
});
