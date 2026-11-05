import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import { Link, type Href } from 'expo-router';
import { Pressable, StyleSheet, Switch, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { font, radius, type Colors } from '@/theme';
import { useStyles, useTheme } from '@/state/ThemeProvider';

export type IconName = React.ComponentProps<typeof Feather>['name'];
export function Icon({ name, size = 16, color }: { name: IconName; size?: number; color?: string }) {
  const { colors } = useTheme();
  return <Feather name={name} size={size} color={color ?? colors.muted} />;
}
type ButtonProps = {
  label: string;
  icon?: IconName;
  onPress?: () => void;
  href?: Href;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  compact?: boolean;
  iconOnly?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};
export function Button({
  label,
  icon,
  onPress,
  href,
  variant = 'secondary',
  disabled,
  compact,
  iconOnly,
  style,
  accessibilityLabel,
}: ButtonProps) {
  const { colors } = useTheme();
  const styles = useStyles(createStyles);
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [focused, setFocused] = useState(false);
  const primary = variant === 'primary';
  const foreground = variant === 'danger' ? '#FFFFFF' : primary ? colors.onPrimary : colors.text;
  const element = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={StyleSheet.flatten([
        styles.button,
        primary ? styles.primary : variant === 'danger' ? styles.danger : variant === 'ghost' ? styles.ghost : styles.secondary,
        compact && { paddingLeft: 13, paddingRight: 13 },
        iconOnly && { width: 44, paddingLeft: 0, paddingRight: 0 },
        hovered && !primary && variant !== 'danger' && { backgroundColor: colors.accentSoft },
        pressed && { opacity: 0.75 },
        focused && { outlineWidth: 2, outlineColor: colors.ring, outlineOffset: 2, borderColor: colors.ring },
        disabled && { opacity: 0.4 },
        style,
      ])}
    >
      <View style={styles.buttonContent}>
        {icon && <Icon name={icon} size={16} color={foreground} />}
        {!iconOnly && <Text numberOfLines={1} style={[styles.buttonText, { color: foreground, flexShrink: 1 }]}>
          {label}
        </Text>}
      </View>
    </Pressable>
  );
  return href ? (
    <Link href={href} asChild>
      {element}
    </Link>
  ) : (
    element
  );
}
export function Brand({ onPress }: { onPress?: () => void } = {}) {
  const { colors, common } = useTheme();
  const styles = useStyles(createStyles);
  return (
    <Link href="/" accessibilityLabel="GigaCode workspace" asChild>
      <Pressable onPress={onPress} style={{ ...common.row,minHeight: 44, gap: 10, alignSelf: 'flex-start' }}>
        <View style={styles.brandMark}>
          <Icon name="terminal" size={17} color={colors.onPrimary} />
        </View>
        <Text style={styles.brand}>
          GigaCode
        </Text>
      </Pressable>
    </Link>
  );
}
export function Pill({ label, dot = false }: { label: string; dot?: boolean }) {
  const styles = useStyles(createStyles);
  const { colors } = useTheme();
  const status = label.split(' ')[0];
  const tone = status === 'SUCCESS' ? colors.success : ['FAILED', 'DEAD_LETTERED'].includes(status) ? colors.error : ['TIMEOUT', 'CANCELLED'].includes(status) ? colors.warning : colors.muted;
  return (
    <View style={styles.pill}>
      {dot && <View style={[styles.dot, { backgroundColor: tone }]} />}
      <Text style={[styles.pillText, { color: tone }]}>{label}</Text>
    </View>
  );
}
export function Notice({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'error' }) {
  const { colors, common } = useTheme();
  const styles = useStyles(createStyles);
  return (
    <View accessibilityLiveRegion="polite" style={[styles.notice, tone === 'error' && { borderColor: colors.error }]}>
      <Icon name={tone === 'error' ? 'alert-circle' : 'info'} color={tone === 'error' ? colors.error : colors.muted} />
      <Text style={[common.muted, { flex: 1, color: tone === 'error' ? colors.error : colors.text }]}>{children}</Text>
    </View>
  );
}
export function ThemeToggle() {
  const { mode, toggle, persistenceError } = useTheme();
  return (
    <View style={{ alignItems: 'flex-end', maxWidth: 280 }}>
      <Button
        label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        icon={mode === 'dark' ? 'sun' : 'moon'}
        accessibilityLabel={`${mode === 'dark' ? 'Dark' : 'Light'} mode active. Switch to ${mode === 'dark' ? 'light' : 'dark'} mode`}
        onPress={toggle}
        compact
        iconOnly
        variant="ghost"
      />
      {persistenceError && <Notice>{persistenceError}</Notice>}
    </View>
  );
}
export function SettingToggle({
  label,
  description,
  value,
  onValueChange,
  disabled = false,
}: {
  label: string;
  description?: string;
  value: boolean;
  onValueChange?: (value: boolean) => void;
  disabled?: boolean;
}) {
  const { colors, common } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 56 }}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={common.text}>{label}</Text>
        {description && <Text style={common.muted}>{description}</Text>}
      </View>
      <Switch
        accessibilityLabel={label}
        accessibilityHint={description}
        disabled={disabled}
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.strongBorder, true: colors.accent }}
        thumbColor={value ? colors.onPrimary : colors.muted}
        ios_backgroundColor={colors.strongBorder}
      />
    </View>
  );
}
const createStyles = (colors: Colors) =>
  StyleSheet.create({
    button: {
      display: 'flex',
      minHeight: 44,
      minWidth: 44,
      maxWidth: '100%',
      flexShrink: 1,
      paddingLeft: 18,
      paddingRight: 18,
       borderRadius: radius,
      borderWidth: 1,
      borderStyle: 'solid',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      flexWrap: 'nowrap',
    },
    buttonContent: {
      minWidth: 0,
      flexShrink: 1,
      display: 'flex',
      flexDirection: 'row',
      flexWrap: 'nowrap',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    primary: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
      boxShadow: `0 1px 2px ${colors.shadow}`,
    },
    danger: { backgroundColor: colors.error, borderColor: colors.error },
    secondary: { backgroundColor: colors.panel, borderColor: colors.strongBorder },
    ghost: { borderColor: 'transparent', backgroundColor: 'transparent' },
    buttonText: { fontFamily: font.medium, fontSize: 14, color: colors.text },
    brandMark: {
      width: 32,
      height: 32,
      borderRadius: 8,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    brand: { fontFamily: font.semibold, color: colors.text, fontSize: 14 },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 7,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 6,
      paddingHorizontal: 9,
      paddingVertical: 5,
      maxWidth: '100%',
      backgroundColor: colors.raised,
    },
    pillText: { color: colors.muted, fontFamily: font.medium, fontSize: 11, flexShrink: 1 },
    dot: { width: 5, height: 5, borderRadius: 4, backgroundColor: colors.muted },
    notice: {
      flexDirection: 'row',
      gap: 10,
      padding: 13,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.raised,
      borderRadius: radius,
    },
  });
