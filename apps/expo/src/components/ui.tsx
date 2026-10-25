import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import { Link, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { font, type Colors } from '@/theme';
import { useStyles, useTheme } from '@/state/ThemeProvider';

export type IconName = React.ComponentProps<typeof Feather>['name'];
export function Icon({ name, size = 16, color }: { name: IconName; size?: number; color?: string }) {
  const { colors } = useTheme();
  return <Feather name={name} size={size} color={color ?? colors.muted} />;
}
type ButtonProps = { label: string; icon?: IconName; onPress?: () => void; href?: Href; variant?: 'primary' | 'secondary' | 'ghost'; disabled?: boolean; compact?: boolean; style?: StyleProp<ViewStyle>; accessibilityLabel?: string };
export function Button({ label, icon, onPress, href, variant = 'secondary', disabled, compact, style, accessibilityLabel }: ButtonProps) {
  const { colors } = useTheme();
  const styles = useStyles(createStyles);
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const primary = variant === 'primary';
  const element = (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)}
      style={StyleSheet.flatten([styles.button, primary ? styles.primary : variant === 'ghost' ? styles.ghost : styles.secondary, compact && { paddingLeft: 13, paddingRight: 13, minHeight: 38 }, hovered && { opacity: 0.9, borderColor: colors.accent }, pressed && { opacity: 0.65 }, disabled && { opacity: 0.4 }, style])}>
      <View style={styles.buttonContent}>
        {icon && <Icon name={icon} size={15} color={primary ? colors.onPrimary : colors.text} />}
        <Text numberOfLines={1} style={[styles.buttonText, primary && { color: colors.onPrimary }]}>{label}</Text>
      </View>
    </Pressable>
  );
  return href ? <Link href={href} asChild>{element}</Link> : element;
}
export function Brand() {
  const { colors, common } = useTheme();
  const styles = useStyles(createStyles);
  return <Link href="/" accessibilityLabel="GigaCode workspace" asChild>
    <Pressable style={common.row}>
      <View style={styles.brandMark}><Icon name="code" size={21} color={colors.cyan} /></View>
      <Text style={styles.brand}>GIGA<Text style={{ color: colors.accent }}>CODE</Text></Text>
    </Pressable>
  </Link>;
}
export function Pill({ label, dot = false }: { label: string; dot?: boolean }) {
  const styles = useStyles(createStyles);
  return <View style={styles.pill}>{dot && <View style={styles.dot} />}<Text style={styles.pillText}>{label}</Text></View>;
}
export function Notice({ children }: { children: React.ReactNode }) {
  const { colors, common } = useTheme();
  const styles = useStyles(createStyles);
  return <View accessibilityLiveRegion="polite" style={styles.notice}><Icon name="info" color={colors.accent} /><Text style={[common.muted, { flex: 1, color: colors.text }]}>{children}</Text></View>;
}
export function ThemeToggle() {
  const { mode, toggle, persistenceError } = useTheme();
  return <View style={{ alignItems: 'flex-end', maxWidth: 280 }}>
    <Button label={mode === 'dark' ? 'Dark' : 'Light'} icon={mode === 'dark' ? 'moon' : 'sun'}
      accessibilityLabel={`${mode === 'dark' ? 'Dark' : 'Light'} mode active. Switch to ${mode === 'dark' ? 'light' : 'dark'} mode`} onPress={toggle} compact />
    {persistenceError && <Notice>{persistenceError}</Notice>}
  </View>;
}
const createStyles = (colors: Colors) => StyleSheet.create({
  button: { display: 'flex', minHeight: 44, paddingLeft: 18, paddingRight: 18, borderRadius: 12, borderWidth: 1, borderStyle: 'solid', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', flexWrap: 'nowrap' },
  buttonContent: { display: 'flex', flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primary: { backgroundColor: colors.primary, borderColor: colors.primary, boxShadow: `0 4px 18px ${colors.glow}` },
  secondary: { backgroundColor: colors.raised, borderColor: colors.border },
  ghost: { borderColor: 'transparent', backgroundColor: 'transparent' },
  buttonText: { fontFamily: font.medium, fontSize: 13, color: colors.text },
  brandMark: { width: 34, height: 34, borderRadius: 11, borderWidth: 1, borderColor: colors.strongBorder, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  brand: { fontFamily: font.bold, color: colors.text, fontSize: 16, letterSpacing: 2 },
  pill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 7, borderWidth: 1, borderColor: colors.border, borderRadius: 30, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: colors.accentSoft },
  pillText: { color: colors.accent, fontFamily: font.medium, fontSize: 10, letterSpacing: 0.6 },
  dot: { width: 5, height: 5, borderRadius: 4, backgroundColor: colors.cyan },
  notice: { flexDirection: 'row', gap: 10, padding: 13, borderWidth: 1, borderColor: colors.strongBorder, backgroundColor: colors.accentSoft, borderRadius: 12 },
});
