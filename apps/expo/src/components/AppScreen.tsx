import type { ReactNode } from 'react';
import { useState } from 'react';
import { Stack } from 'expo-router';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { useAuth } from '@/state/AuthProvider';
import { useTheme } from '@/state/ThemeProvider';
import { font, radius } from '@/theme';
import { Button, Notice } from './ui';
import { AppShell, useContentWidth } from './AppShell';

export function AppScreen({
  title,
  subtitle,
  children,
  protected: guarded = true,
  admin = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  protected?: boolean;
  admin?: boolean;
}) {
  const { colors, common } = useTheme();
  const width = useContentWidth();
  const auth = useAuth();
  const allowed = !guarded || !!auth.me;
  return (
    <AppShell title={title}>
      <Stack.Screen options={{ title: `${title} — GigaCode` }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>
          <View
            style={{
              width: '100%',
              maxWidth: 1152,
              alignSelf: 'center',
              paddingHorizontal: width < 600 ? 16 : 32,
              paddingTop: width < 600 ? 24 : 36,
              paddingBottom: 40,
            }}
          >
            <Text
              accessibilityRole="header"
              style={{
                color: colors.text,
                fontFamily: font.semibold,
                fontSize: width < 600 ? 26 : 30,
                letterSpacing: -0.6,
                marginBottom: 10,
              }}
            >
              {title}
            </Text>
            {!!subtitle && (
              <Text style={[common.muted, { fontSize: 15, lineHeight: 24, marginBottom: 20 }]}>
                {subtitle}
              </Text>
            )}
            {auth.error && <Notice>{auth.error}</Notice>}
            {!auth.ready ? (
              <Loading />
            ) : !allowed ? (
              <Card title={auth.signedIn ? 'Reconnect your session' : 'Sign in to continue'}>
                <Text style={common.muted}>
                  Device drafts are always available. Account data and execution require an authenticated
                  connection.
                </Text>
                {auth.signedIn ? (
                  <Button
                    label="Retry session"
                    onPress={() => {
                      void auth.refreshMe();
                    }}
                  />
                ) : (
                  <Button label="Sign in" href="/login" variant="primary" />
                )}
                <Button label="Connection settings" href="/connection" />
              </Card>
            ) : admin && auth.me?.user.role !== 'platform_admin' ? (
              <Notice>This page is available only to platform administrators.</Notice>
            ) : (
              <View style={{ gap: 18, marginTop: 12 }}>{children}</View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </AppShell>
  );
}
export function Card({ title, children }: { title?: string; children: ReactNode }) {
  const { colors, common } = useTheme();
  return (
    <View
      style={{
        padding: 16,
        minWidth: 0,
        borderRadius: radius,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.panel,
        gap: 14,
        boxShadow: `0 1px 2px ${colors.shadow}`,
      }}
    >
      {title && (
        <Text accessibilityRole="header" style={[common.text, { fontSize: 16, fontFamily: font.semibold }]}>
          {title}
        </Text>
      )}
      {children}
    </View>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const { colors, common } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 8, flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
      <Text style={[common.text, { fontFamily: font.medium }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.faint}
        autoCapitalize="none"
        autoCorrect={false}
        {...props}
        selectionColor={colors.selection}
        onFocus={(event) => {
          setFocused(true);
          props.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          props.onBlur?.(event);
        }}
        style={[
          {
            color: colors.text,
            fontFamily: font.regular,
            backgroundColor: colors.panel,
            borderWidth: 1,
            borderColor: focused ? colors.ring : colors.strongBorder,
            borderRadius: radius,
            padding: 12,
            fontSize: 16,
            minHeight: 48,
            outlineWidth: 0,
          },
          props.style,
        ]}
      />
    </View>
  );
}
export function Loading() {
  const { colors } = useTheme();
  return (
    <ActivityIndicator accessibilityLabel="Loading from API" style={{ margin: 18 }} color={colors.accent} />
  );
}
export function ResourceState({
  resource,
  empty,
}: {
  resource: { loading: boolean; error: string | null; reload: () => void; data?: unknown };
  empty?: boolean;
}) {
  const { common } = useTheme();
  return (
    <>
      {resource.loading && !resource.data && <Loading />}
      {resource.error && (
        <>
          <Notice tone="error">{resource.error}</Notice>
          <Button label="Retry" onPress={resource.reload} />
        </>
      )}
      {empty && !resource.loading && !resource.error && <Text style={common.muted}>Nothing here yet.</Text>}
    </>
  );
}
export function FlowRow({ children }: { children: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>{children}</View>
  );
}
