import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Stack } from 'expo-router';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';
import { Brand, Button, Icon, Notice, Pill, ThemeToggle } from './ui';
import { Orbit } from './Orbit';
import { loginSchema, requireAccountService, signupSchema } from '@/lib/auth';
import { font, type Colors } from '@/theme';
import { useStyles, useTheme } from '@/state/ThemeProvider';

type Values = z.infer<typeof signupSchema>;
export function AuthScreen({ mode }: { mode: 'login' | 'signup' }) {
  const { colors, common } = useTheme();
  const styles = useStyles(createStyles);
  const signup = mode === 'signup';
  const { width } = useWindowDimensions();
  const wide = width >= 1000;
  const compact = width < 600;
  const [showPassword, setShowPassword] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [focused, setFocused] = useState<string | null>(null);
  const { control, handleSubmit, formState: { errors, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(signup ? signupSchema : loginSchema.extend({ name: z.string() })),
    defaultValues: { name: '', email: '', password: '' },
  });
  const submit = handleSubmit(async () => {
    setConnectionError('');
    try { await requireAccountService(); } catch (error) { setConnectionError(error instanceof Error ? error.message : 'Account service unavailable. Please keep using device drafts.'); }
  });
  const fields: { name: keyof Values; label: string; placeholder: string; icon: 'user' | 'mail' | 'lock' }[] = [
    ...(signup ? [{ name: 'name' as const, label: 'Your name', placeholder: 'Ada Lovelace', icon: 'user' as const }] : []),
    { name: 'email', label: 'Email address', placeholder: 'you@youruniverse.com', icon: 'mail' },
    { name: 'password', label: 'Password', placeholder: signup ? 'At least 8 characters' : 'Your password', icon: 'lock' },
  ];
  return <SafeAreaView style={styles.safe}>
    <Stack.Screen options={{ title: signup ? 'Create your account — GigaCode' : 'Welcome back — GigaCode' }} />
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>
        <View style={[styles.page, compact && { paddingHorizontal: 22 }]}>
          <View style={[styles.header, compact && { flexWrap: 'wrap', gap: 12, paddingVertical: 18 }]}><Brand /><View style={[common.row, { gap: compact ? 4 : 12 }]}><ThemeToggle /><Button label={compact ? 'Workspace' : 'Back to workspace'} icon="arrow-left" href="/" variant="ghost" compact /></View></View>
          <View style={[styles.body, !wide && { flexDirection: 'column', paddingVertical: compact ? 35 : 60 }]}>
            {wide && <View style={styles.aside}>
              <Pill label="CURIOUS MINDS. LIMITLESS POSSIBILITIES." dot />
              <Text style={styles.asideTitle}>Small beginnings.{"\n"}<Text style={{ color: colors.accent }}>Extraordinary ideas.</Text></Text>
              <Text style={[common.muted, { maxWidth: 340, fontSize: 15, lineHeight: 25, marginTop: 22 }]}>A thought becomes a line of code.{"\n"}A line of code becomes something more.{"\n"}This is your space to find out.</Text>
              <View style={styles.orbit}><Orbit /></View>
              <View style={styles.asideBottom}><View style={styles.asideLine} /><Text style={styles.asideCaption}>FROM YOUR FIRST PRINT TO YOUR NEXT BIG THING.</Text></View>
            </View>}
            <View style={[styles.formColumn, !wide && { borderLeftWidth: 0, paddingHorizontal: 0, width: '100%' }]}>
              <View style={styles.form}>
                <View style={common.row}><View style={styles.stepLine} /><Text style={common.eyebrow}>{signup ? 'YOUR NEXT CHAPTER' : 'RIGHT WHERE YOU LEFT OFF'}</Text></View>
                <Text accessibilityRole="header" style={[styles.title, compact && { fontSize: 37, lineHeight: 43 }]}>{signup ? 'Hello, possibility.' : 'Welcome back.'}</Text>
                <Text style={[common.muted, { fontSize: 14, lineHeight: 23, marginTop: 12, marginBottom: 24 }]}>{signup ? 'A home for your code. A little space to think big.' : 'Good ideas deserve another line. Let’s keep going.'}</Text>
                <View style={styles.connectionLabel}><Icon name="radio" size={13} color={colors.accent} /><Text style={styles.connectionText}>UI preview · account service not connected</Text></View>
                <View style={{ gap: 20, marginTop: 25 }}>
                  {fields.map(field => <View key={field.name} style={{ gap: 9 }}>
                    <Text nativeID={`${field.name}-label`} style={styles.label}>{field.label}</Text>
                    <Controller control={control} name={field.name} render={({ field: { onChange, onBlur, value } }) => <View style={[styles.field, focused === field.name && { borderColor: colors.accent, backgroundColor: colors.accentSoft }, !!errors[field.name] && { borderColor: colors.error }]}>
                      <Icon name={field.icon} size={16} color={focused === field.name ? colors.accent : colors.faint} />
                      <TextInput accessibilityLabel={field.label} accessibilityLabelledBy={`${field.name}-label`} value={value} onChangeText={onChange} onFocus={() => setFocused(field.name)} onBlur={() => { onBlur(); setFocused(null); }} placeholder={field.placeholder} placeholderTextColor={colors.faint} style={styles.input}
                        autoCapitalize={field.name === 'name' ? 'words' : 'none'} autoCorrect={false} keyboardType={field.name === 'email' ? 'email-address' : 'default'} secureTextEntry={field.name === 'password' && !showPassword}
                        autoComplete={field.name === 'password' ? signup ? 'new-password' : 'current-password' : field.name === 'name' ? 'name' : 'email'}
                        returnKeyType={field.name === 'password' ? 'go' : 'next'} onSubmitEditing={field.name === 'password' ? () => { void submit(); } : undefined} />
                      {field.name === 'password' && <Pressable accessibilityRole="button" accessibilityLabel={showPassword ? 'Hide password' : 'Show password'} onPress={() => setShowPassword(value => !value)} style={styles.reveal}><Icon name={showPassword ? 'eye-off' : 'eye'} size={17} /></Pressable>}
                    </View>} />
                    {errors[field.name] && <Text accessibilityRole="alert" style={styles.error}>{errors[field.name]?.message}</Text>}
                  </View>)}
                </View>
                {signup && <Text style={[common.muted, { fontSize: 11, lineHeight: 18, marginTop: 14 }]}>Use a unique password. This preview never transmits or stores your credentials.</Text>}
                <View style={{ marginTop: 26, gap: 14 }}>
                  <Button label={isSubmitting ? 'Checking availability…' : signup ? 'Create your account' : 'Sign in to GigaCode'} icon={isSubmitting ? undefined : 'arrow-right'} variant="primary" onPress={() => { void submit(); }} disabled={isSubmitting} style={{ minHeight: 51 }} />
                  {isSubmitting && <ActivityIndicator accessibilityLabel="Checking account service" color={colors.accent} />}
                  {!!connectionError && <Notice>{connectionError}</Notice>}
                </View>
                <View style={[common.row, { justifyContent: 'center', gap: 2, marginTop: 18, flexWrap: 'wrap' }]}><Text style={common.muted}>{signup ? 'Already have an account?' : 'New to the playground?'}</Text><Button label={signup ? 'Sign in' : 'Create an account'} href={signup ? '/login' : '/signup'} variant="ghost" compact /></View>
                <View style={styles.divider} />
                <Button label="Just here to code? Explore as a guest" icon="arrow-up-right" href="/" variant="ghost" compact />
                <Text style={styles.guestNote}>No account needed for device-local drafts.</Text>
              </View>
            </View>
          </View>
          <View style={styles.footer}><Text style={styles.footerText}>GIGACODE <Text style={{ color: colors.accent }}> / </Text> MAKE SOMETHING THAT MATTERS.</Text><View style={[common.row, { gap: 6 }]}><Icon name="hard-drive" size={11} /><Text style={styles.footerText}>LOCAL FIRST. ALWAYS YOURS.</Text></View></View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
const createStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  page: { flex: 1, paddingHorizontal: 44, maxWidth: 1480, alignSelf: 'center', width: '100%' },
  header: { minHeight: 89, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  body: { flex: 1, flexDirection: 'row', paddingVertical: 64, minHeight: 720 },
  aside: { flex: 1, paddingTop: 12, paddingRight: 40, minHeight: 610, overflow: 'hidden' },
  asideTitle: { fontFamily: font.medium, color: colors.text, fontSize: 48, lineHeight: 55, letterSpacing: -2, marginTop: 33 },
  orbit: { marginTop: -20, marginLeft: -10, height: 280, justifyContent: 'center', alignItems: 'flex-start' },
  asideBottom: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 'auto', paddingTop: 20 },
  asideLine: { height: 1, width: 28, backgroundColor: colors.accent },
  asideCaption: { fontFamily: font.regular, fontSize: 8, color: colors.faint, letterSpacing: 1.2 },
  formColumn: { flex: 1, borderLeftWidth: 1, borderLeftColor: colors.border, paddingLeft: 62, paddingRight: 20, justifyContent: 'center', alignItems: 'center' },
  form: { width: '100%', maxWidth: 390 },
  stepLine: { width: 20, height: 1, backgroundColor: colors.accent },
  title: { color: colors.text, fontFamily: font.medium, fontSize: 42, lineHeight: 49, letterSpacing: -1.8, marginTop: 20 },
  connectionLabel: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.accentSoft, borderRadius: 12 },
  connectionText: { fontFamily: font.regular, fontSize: 10, color: colors.accent, flexShrink: 1 },
  label: { fontFamily: font.medium, color: colors.text, fontSize: 12 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 13, borderWidth: 1, borderColor: colors.strongBorder, backgroundColor: colors.panel, minHeight: 53, paddingLeft: 15, paddingRight: 4 },
  input: { flex: 1, minWidth: 0, paddingVertical: 15, fontFamily: font.regular, color: colors.text, fontSize: 13, outlineWidth: 0 },
  reveal: { minWidth: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  error: { fontFamily: font.regular, fontSize: 11, color: colors.error, lineHeight: 17 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 22 },
  guestNote: { textAlign: 'center', fontFamily: font.regular, fontSize: 10, color: colors.faint, marginTop: 4 },
  footer: { borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 23, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 16 },
  footerText: { color: colors.faint, fontFamily: font.regular, fontSize: 8, letterSpacing: 1 },
});
