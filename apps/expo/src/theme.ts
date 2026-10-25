import { Platform, StyleSheet } from 'react-native';
import type { Colors } from './lib/palette';
export { palettes, type Colors, type ThemeMode } from './lib/palette';

export const font = { regular: 'SpaceGrotesk_400Regular', medium: 'SpaceGrotesk_500Medium', bold: 'SpaceGrotesk_700Bold' };
export const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });
export const createCommon = (colors: Colors) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  text: { fontFamily: font.regular, color: colors.text, fontSize: 14 },
  muted: { fontFamily: font.regular, color: colors.muted, fontSize: 13, lineHeight: 21 },
  eyebrow: { fontFamily: font.medium, color: colors.muted, fontSize: 10, letterSpacing: 2.2 },
  border: { borderWidth: 1, borderColor: colors.border, borderRadius: 14 },
});
