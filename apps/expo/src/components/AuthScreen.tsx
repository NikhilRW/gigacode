import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { router, Stack } from 'expo-router';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';
import { Brand, Button, Icon, Notice, ThemeToggle } from './ui';
import { loginSchema, signupSchema } from '@/lib/auth';
import { useAuth } from '@/state/AuthProvider';
import { describeError } from '@/lib/client';
import { credentialStorageDescription } from '@/lib/credentialStore';
import { font, mono, radius, type Colors } from '@/theme';
import { useStyles, useTheme } from '@/state/ThemeProvider';

type Values = z.infer<typeof signupSchema>;
export function AuthScreen({ mode }: { mode: 'login' | 'signup' }) {
  const { colors, common } = useTheme();
  const styles = useStyles(createStyles);
  const auth = useAuth();
  const signup = mode === 'signup';
  const { width } = useWindowDimensions();
  const wide = width >= 1000;
  const [showPassword, setShowPassword] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [focused, setFocused] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(
      signup ? signupSchema : loginSchema.extend({ name: z.string(), tenantName: z.string() }),
    ),
    defaultValues: { name: '', tenantName: '', email: '', password: '' },
  });
  const submit = handleSubmit(async (values) => {
    setConnectionError('');
    try {
      await auth.login(signup ? values : { email: values.email.trim(), password: values.password }, signup);
      router.replace('/dashboard');
    } catch (error) {
      setConnectionError(describeError(error));
    }
  });
  const fields: { name: keyof Values; label: string; placeholder: string; icon: 'user' | 'mail' | 'lock' }[] =
    [
      ...(signup
        ? [{ name: 'name' as const, label: 'Your name', placeholder: 'Ada Lovelace', icon: 'user' as const }]
        : []),
      ...(signup
        ? [
            {
              name: 'tenantName' as const,
              label: 'Workspace name',
              placeholder: 'My workspace',
              icon: 'user' as const,
            },
          ]
        : []),
      { name: 'email', label: 'Email address', placeholder: 'you@youruniverse.com', icon: 'mail' },
      {
        name: 'password',
        label: 'Password',
        placeholder: signup ? 'At least 10 characters' : 'Your password',
        icon: 'lock',
      },
    ];
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'right', 'bottom', 'left']}>
      <Stack.Screen
        options={{ title: signup ? 'Create your account — GigaCode' : 'Welcome back — GigaCode' }}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          style={styles.scroll}
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="never"
          contentContainerStyle={styles.scrollContent}
        >
          <View style={styles.page}>
            <View style={[styles.body, !wide && styles.bodySingle]}>
              {wide && (
                <View style={styles.aside}>
                  <Brand />
                  <View style={{ gap: 32, paddingVertical: 48 }}>
                    <Text style={styles.asideTitle}>
                      Run code,{'\n'}<Text style={{ color: colors.muted }}>safely contained.</Text>
                    </Text>
                    {[
                      {
                        icon: 'shield' as const,
                        text: 'Layered isolation: namespaces, seccomp and resource limits around every run.',
                      },
                      {
                        icon: 'clock' as const,
                        text: 'Strict time and memory limits, with clear explanations when a run hits them.',
                      },
                      {
                        icon: 'zap' as const,
                        text: 'Python, Node.js, C and C++, from your device or a single API call.',
                      },
                    ].map((point) => (
                      <View key={point.icon} style={{ flexDirection: 'row', gap: 12 }}>
                        <Icon name={point.icon} color={colors.text} />
                        <Text style={[common.muted, { flex: 1 }]}>{point.text}</Text>
                      </View>
                    ))}
                  </View>
                  <Text style={[common.muted, { fontSize: 12 }]}>
                    Linux sandboxing is defence in depth, not a guarantee.
                  </Text>
                </View>
              )}
              <View style={[styles.formColumn, wide ? styles.formColumnWide : styles.formColumnSingle]}>
                <View style={styles.headerActions}>
                  <Button label="Workspace" icon="arrow-left" href="/" variant="ghost" compact />
                  <ThemeToggle />
                </View>
                <View style={styles.form}>
                  {!wide && <View style={{ marginBottom: 28 }}><Brand /></View>}
                  <Text accessibilityRole="header" style={styles.title}>
                    {signup ? 'Create your workspace' : 'Sign in'}
                  </Text>
                  <Text
                    style={[common.muted, { fontSize: 14, lineHeight: 23, marginTop: 12, marginBottom: 24 }]}
                  >
                    {signup
                      ? 'Free to start. Your next program begins here.'
                      : 'Welcome back. Enter your details to continue.'}
                  </Text>
                  <View style={styles.connection}>
                    <View style={styles.connectionLabel}>
                      <Icon name="server" size={14} />
                      <Text selectable style={styles.connectionText}>
                        {auth.baseUrl || 'Set your API server before signing in'}
                      </Text>
                    </View>
                    <Button
                      label="Change API connection"
                      href="/connection"
                      variant="ghost"
                      compact
                      style={styles.connectionAction}
                    />
                  </View>
                  <View style={{ gap: 20, marginTop: 25 }}>
                    {fields.map((field) => (
                      <View key={field.name} style={{ gap: 9 }}>
                        <Text nativeID={`${field.name}-label`} style={styles.label}>
                          {field.label}
                        </Text>
                        <Controller
                          control={control}
                          name={field.name}
                          render={({ field: { onChange, onBlur, value } }) => (
                            <View
                              style={[
                                styles.field,
                                focused === field.name && {
                                  borderColor: colors.accent,
                                  backgroundColor: colors.panel,
                                },
                                !!errors[field.name] && { borderColor: colors.error },
                              ]}
                            >
                              <TextInput
                                accessibilityLabel={field.label}
                                accessibilityLabelledBy={`${field.name}-label`}
                                value={value}
                                onChangeText={onChange}
                                onFocus={() => setFocused(field.name)}
                                onBlur={() => {
                                  onBlur();
                                  setFocused(null);
                                }}
                                placeholder={field.placeholder}
                                placeholderTextColor={colors.faint}
                                selectionColor={colors.selection}
                                style={styles.input}
                                autoCapitalize={field.name === 'name' ? 'words' : 'none'}
                                autoCorrect={false}
                                keyboardType={field.name === 'email' ? 'email-address' : 'default'}
                                secureTextEntry={field.name === 'password' && !showPassword}
                                autoComplete={
                                  field.name === 'password'
                                    ? signup
                                      ? 'new-password'
                                      : 'current-password'
                                    : field.name === 'name'
                                      ? 'name'
                                      : field.name === 'email'
                                        ? 'email'
                                        : 'off'
                                }
                                returnKeyType={field.name === 'password' ? 'go' : 'next'}
                                onSubmitEditing={
                                  field.name === 'password'
                                    ? () => {
                                        void submit();
                                      }
                                    : undefined
                                }
                              />
                              {field.name === 'password' && (
                                <Pressable
                                  accessibilityRole="button"
                                  accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                                  onPress={() => setShowPassword((value) => !value)}
                                  style={styles.reveal}
                                >
                                  <Icon name={showPassword ? 'eye-off' : 'eye'} size={17} />
                                </Pressable>
                              )}
                            </View>
                          )}
                        />
                        {errors[field.name] && (
                          <Text accessibilityRole="alert" style={styles.error}>
                            {errors[field.name]?.message}
                          </Text>
                        )}
                      </View>
                    ))}
                  </View>
                  <Text style={[common.muted, { fontSize: 11, lineHeight: 18, marginTop: 14 }]}>
                    Credentials are sent only to your configured API. Passwords are never stored on this
                    device. {credentialStorageDescription}
                  </Text>
                  <View style={{ marginTop: 26, gap: 14 }}>
                    <Button
                      label={
                        isSubmitting
                          ? signup ? 'Creating…' : 'Signing in…'
                          : signup ? 'Create account' : 'Sign in'
                      }
                      variant="primary"
                      onPress={() => {
                        void submit();
                      }}
                      disabled={isSubmitting || !auth.ready || !auth.baseUrl}
                      style={{ minHeight: 48 }}
                    />
                    {isSubmitting && (
                      <ActivityIndicator
                        accessibilityLabel="Checking account service"
                        color={colors.accent}
                      />
                    )}
                    {!!connectionError && <Notice tone="error">{connectionError}</Notice>}
                  </View>
                  <View
                    style={[
                      common.row,
                      { justifyContent: 'center', gap: 2, marginTop: 18, flexWrap: 'wrap' },
                    ]}
                  >
                    <Text style={common.muted}>
                      {signup ? 'Already have an account?' : 'No account?'}
                    </Text>
                    <Button
                      label={signup ? 'Sign in' : 'Create an account'}
                      href={signup ? '/login' : '/signup'}
                      variant="ghost"
                      compact
                    />
                  </View>
                  <View style={styles.divider} />
                  <Button
                    label="Continue with device drafts"
                    icon="arrow-up-right"
                    href="/"
                    variant="ghost"
                    compact
                  />
                  <Text style={styles.guestNote}>No account needed for device-local drafts.</Text>
                </View>
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
const createStyles = (colors: Colors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    scroll: { flex: 1 },
    scrollContent: { flexGrow: 1 },
    page: {
      flexGrow: 1,
      flexShrink: 0,
      minWidth: 0,
      alignSelf: 'center',
      width: '100%',
    },
    headerActions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 4,
      maxWidth: '100%',
      alignSelf: 'stretch',
      marginBottom: 28,
    },
    body: { flexGrow: 1, flexDirection: 'row', minWidth: 0 },
    bodySingle: { flexDirection: 'column', justifyContent: 'center', minHeight: 0 },
    aside: {
      flex: 1,
      padding: 48,
      minHeight: 720,
      justifyContent: 'space-between',
      backgroundColor: colors.sidebar,
      borderRightWidth: 1,
      borderColor: colors.border,
    },
    asideTitle: {
      fontFamily: font.semibold,
      color: colors.text,
      fontSize: 36,
      lineHeight: 44,
      letterSpacing: -1,
    },
    formColumn: {
      minWidth: 0,
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: 36,
    },
    formColumnWide: {
      flex: 1.1,
      paddingHorizontal: 48,
    },
    formColumnSingle: { width: '100%', flexGrow: 1 },
    form: { width: '100%', maxWidth: 384, minWidth: 0, marginVertical: 'auto', paddingVertical: 16 },
    title: {
      color: colors.text,
      fontFamily: font.semibold,
      fontSize: 26,
      lineHeight: 34,
      letterSpacing: -0.6,
    },
    connection: {
      gap: 4,
      paddingTop: 12,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.raised,
      borderRadius: radius,
    },
    connectionLabel: { flexDirection: 'row', gap: 8, alignItems: 'center', minWidth: 0 },
    connectionText: {
      fontFamily: mono,
      fontSize: 11,
      lineHeight: 18,
      color: colors.muted,
      flex: 1,
      minWidth: 0,
    },
    connectionAction: { alignSelf: 'flex-start', paddingLeft: 0, paddingRight: 0, maxWidth: '100%' },
    label: { fontFamily: font.medium, color: colors.text, fontSize: 14 },
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      borderRadius: radius,
      borderWidth: 1,
      borderColor: colors.strongBorder,
      backgroundColor: colors.panel,
      minHeight: 48,
      paddingLeft: 12,
      paddingRight: 4,
    },
    input: {
      flex: 1,
      minWidth: 0,
      paddingVertical: 12,
      fontFamily: font.regular,
      color: colors.text,
      fontSize: 16,
      outlineWidth: 0,
    },
    reveal: { minWidth: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
    error: { fontFamily: font.regular, fontSize: 12, color: colors.error, lineHeight: 18 },
    divider: { height: 1, backgroundColor: colors.border, marginVertical: 22 },
    guestNote: {
      textAlign: 'center',
      fontFamily: font.regular,
      fontSize: 12,
      color: colors.faint,
      marginTop: 4,
    },
  });
