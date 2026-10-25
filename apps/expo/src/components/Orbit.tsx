import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '@/state/ThemeProvider';

// A static optical sculpture: refractive glass, an illuminated rim and satellite arcs.
// No animation, canvas, external assets or reduced-motion exceptions needed.
export function Orbit({ compact = false }: { compact?: boolean }) {
  const { colors } = useTheme();
  const size = compact ? 290 : 400;
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
    <View style={{ position: 'absolute', width: size * 0.62, height: size * 0.62, borderRadius: size, backgroundColor: colors.glow, boxShadow: `0 0 70px 25px ${colors.glow}` }} />
    {[0.98, 0.82].map((scale, i) => <View key={scale} style={{ position: 'absolute', width: size * scale, height: size * 0.44 * scale, borderRadius: size, borderWidth: 1, borderColor: i ? colors.strongBorder : colors.border, transform: [{ rotate: '-28deg' }] }} />)}
    <View style={{ width: size * 0.59, height: size * 0.59, borderRadius: size, borderWidth: 1, borderColor: colors.lensLight, overflow: 'hidden', transform: [{ rotate: '-30deg' }], boxShadow: `8px 16px 40px ${colors.glow}` }}>
      <LinearGradient colors={[colors.lensLight, colors.lensMid, colors.lensDeep]} locations={[0, 0.28, 1]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={{ position: 'absolute', top: '12%', left: '12%', width: '76%', height: '76%', borderRadius: size, borderWidth: size * 0.018, borderColor: colors.lensLight, opacity: 0.7 }} />
      <LinearGradient colors={[colors.lensDeep, colors.lensMid, colors.lensLight]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', top: '23%', left: '23%', width: '54%', height: '54%', borderRadius: size, borderWidth: 1, borderColor: colors.lensLight }} />
      <View style={{ position: 'absolute', top: '9%', left: '22%', width: '52%', height: '9%', borderRadius: size, backgroundColor: colors.lensLight, opacity: 0.65, boxShadow: `0 0 20px ${colors.lensLight}` }} />
    </View>
    <View style={{ position: 'absolute', width: size * 0.94, height: size * 0.25, borderRadius: size, borderBottomWidth: 2, borderColor: colors.lensLight, transform: [{ rotate: '-28deg' }], boxShadow: `0 6px 16px -8px ${colors.cyan}` }} />
    {[{ top: '23%', left: '16%' }, { top: '73%', left: '80%' }].map((point, i) => <View key={i} style={{ position: 'absolute', top: point.top as `${number}%`, left: point.left as `${number}%`, width: i ? 5 : 8, height: i ? 5 : 8, borderRadius: 8, backgroundColor: colors.lensLight, boxShadow: `0 0 16px 4px ${colors.glow}` }} />)}
  </View>;
}
