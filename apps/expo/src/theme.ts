import { StyleSheet } from 'react-native';
import type { Colors } from './lib/palette';
export { palettes, type Colors, type ThemeMode } from './lib/palette';

export const font = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
};
export const mono = 'JetBrainsMono_400Regular';
export const radius = 10;
export const createCommon = (colors: Colors) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    text: { fontFamily: font.regular, color: colors.text, fontSize: 14, lineHeight: 21 },
    muted: { fontFamily: font.regular, color: colors.muted, fontSize: 13, lineHeight: 21 },
    eyebrow: { fontFamily: font.semibold, color: colors.muted, fontSize: 11, letterSpacing: 0.8 },
    border: { borderWidth: 1, borderColor: colors.border, borderRadius: radius },
  });
