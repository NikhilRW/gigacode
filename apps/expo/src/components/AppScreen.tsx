import type { ReactNode } from 'react';
import { Stack, usePathname, type Href } from 'expo-router';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View, useWindowDimensions, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/state/AuthProvider';
import { useTheme } from '@/state/ThemeProvider';
import { font } from '@/theme';
import { Brand, Button, Notice, ThemeToggle } from './ui';

export function Navigation() {
  const { me, signedIn } = useAuth();
  const pathname = usePathname();
  const links: { label: string; href: Href }[] = [{ label: 'Workspace', href: '/' }, ...(signedIn ? [{ label: 'Dashboard', href: '/dashboard' }, { label: 'History', href: '/history' }, { label: 'API keys', href: '/keys' }, { label: 'Account', href: '/account' }] : [{ label: 'Sign in', href: '/login' }]), { label: 'Connection', href: '/connection' }];
  if (me?.user.role === 'platform_admin') links.push({ label: 'Admin', href: '/admin' });
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 6, paddingVertical: 12 }}><View style={{ flexDirection: 'row', gap: 6 }}>{links.map(link => <Button key={link.label} label={link.label} href={link.href} variant={pathname === link.href ? 'primary' : 'ghost'} compact style={{ minHeight: 44 }} />)}</View></ScrollView>;
}
export function AppScreen({ title, subtitle, children, protected: guarded = true, admin = false }: { title: string; subtitle?: string; children: ReactNode; protected?: boolean; admin?: boolean }) {
  const { colors, common } = useTheme();
  const { width } = useWindowDimensions();
  const auth = useAuth();
  const allowed = !guarded || !!auth.me;
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
    <Stack.Screen options={{ title: `${title} — GigaCode` }} />
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>
        <View style={{ width: '100%', maxWidth: 1400, alignSelf: 'center', paddingHorizontal: width < 600 ? 18 : 40, paddingBottom: 40 }}>
          <View style={{ paddingVertical: 18, flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: colors.border }}><Brand /><ThemeToggle /></View>
          <Navigation />
          <Text accessibilityRole="header" style={{ color: colors.text, fontFamily: font.medium, fontSize: width < 600 ? 32 : 44, marginTop: 18, marginBottom: 10 }}>{title}</Text>
          {!!subtitle && <Text style={[common.muted, { fontSize: 15, lineHeight: 24, marginBottom: 20 }]}>{subtitle}</Text>}
          {auth.error && <Notice>{auth.error}</Notice>}
          {!auth.ready ? <Loading /> : !allowed ? <Card title={auth.signedIn ? 'Reconnect your session' : 'Sign in to continue'}><Text style={common.muted}>Device drafts are always available. Account data and execution require an authenticated connection.</Text>{auth.signedIn ? <Button label="Retry session" onPress={() => { void auth.refreshMe(); }} /> : <Button label="Sign in" href="/login" variant="primary" />}<Button label="Connection settings" href="/connection" /></Card> : admin && auth.me?.user.role !== 'platform_admin' ? <Notice>This page is available only to platform administrators.</Notice> : <View style={{ gap: 18, marginTop: 12 }}>{children}</View>}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
export function Card({ title, children }: { title?: string; children: ReactNode }) {
  const { colors, common } = useTheme();
  return <View style={{ padding: 20, borderRadius: 18, borderWidth: 1, borderColor: colors.strongBorder, backgroundColor: colors.panel, gap: 14 }}>
    {title && <Text accessibilityRole="header" style={[common.text, { fontSize: 20, fontFamily: font.medium }]}>{title}</Text>}{children}
  </View>;
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const { colors, common } = useTheme();
  return <View style={{ gap: 8, flexGrow: 1, minWidth: 120 }}><Text style={common.text}>{label}</Text><TextInput accessibilityLabel={label} placeholderTextColor={colors.faint} autoCapitalize="none" autoCorrect={false} {...props} style={[{ color: colors.text, backgroundColor: colors.editor, borderWidth: 1, borderColor: colors.strongBorder, borderRadius: 12, padding: 13, fontSize: 16, minHeight: 48 }, props.style]} /></View>;
}
export function Loading() { const { colors } = useTheme(); return <ActivityIndicator accessibilityLabel="Loading from API" style={{ margin: 18 }} color={colors.accent} />; }
export function ResourceState({ resource, empty }: { resource: { loading: boolean; error: string | null; reload: () => void; data?: unknown }; empty?: boolean }) {
  const { common } = useTheme();
  return <>{resource.loading && !resource.data && <Loading />}{resource.error && <><Notice>{resource.error}</Notice><Button label="Retry" onPress={resource.reload} /></>}{empty && !resource.loading && !resource.error && <Text style={common.muted}>Nothing here yet.</Text>}</>;
}
export function FlowRow({ children }: { children: ReactNode }) { return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>{children}</View>; }
