import { StyleSheet, View } from 'react-native';
import { useTheme } from '@/state/ThemeProvider';

// Optional static illustration, using the same neutral surfaces as the app shell.
// No animation, canvas, external assets or reduced-motion exceptions needed.
export function Orbit({ compact = false }: { compact?: boolean }) {
  const { colors } = useTheme();
  const size = compact ? 290 : 400;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
    >
      <View
        style={{
          position: 'absolute',
          width: size * 0.62,
          height: size * 0.62,
          borderRadius: size,
          backgroundColor: colors.raised,
        }}
      />
      {[0.98, 0.82].map((scale, i) => (
        <View
          key={scale}
          style={{
            position: 'absolute',
            width: size * scale,
            height: size * 0.44 * scale,
            borderRadius: size,
            borderWidth: 1,
            borderColor: i ? colors.strongBorder : colors.border,
            transform: [{ rotate: '-28deg' }],
          }}
        />
      ))}
      <View
        style={{
          width: size * 0.59,
          height: size * 0.59,
          borderRadius: size,
          borderWidth: 1,
          borderColor: colors.strongBorder,
          overflow: 'hidden',
          transform: [{ rotate: '-30deg' }],
          boxShadow: `0 2px 8px ${colors.shadow}`,
        }}
      >
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.panel }]} />
        <View
          style={{
            position: 'absolute',
            top: '12%',
            left: '12%',
            width: '76%',
            height: '76%',
            borderRadius: size,
            borderWidth: size * 0.018,
            borderColor: colors.border,
            opacity: 0.7,
          }}
        />
        <View
          style={{
            position: 'absolute',
            top: '23%',
            left: '23%',
            width: '54%',
            height: '54%',
            borderRadius: size,
            borderWidth: 1,
            borderColor: colors.strongBorder,
            backgroundColor: colors.raised,
          }}
        />
        <View
          style={{
            position: 'absolute',
            top: '9%',
            left: '22%',
            width: '52%',
            height: '9%',
            borderRadius: size,
            backgroundColor: colors.border,
            opacity: 0.65,
          }}
        />
      </View>
      <View
        style={{
          position: 'absolute',
          width: size * 0.94,
          height: size * 0.25,
          borderRadius: size,
          borderBottomWidth: 2,
          borderColor: colors.strongBorder,
          transform: [{ rotate: '-28deg' }],
        }}
      />
      {[
        { top: '23%', left: '16%' },
        { top: '73%', left: '80%' },
      ].map((point, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            top: point.top as `${number}%`,
            left: point.left as `${number}%`,
            width: i ? 5 : 8,
            height: i ? 5 : 8,
            borderRadius: 8,
            backgroundColor: colors.muted,
          }}
        />
      ))}
    </View>
  );
}
