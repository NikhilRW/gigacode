import { useState } from 'react';
import { Text } from 'react-native';
import { AppScreen, Card, Field } from '@/components/AppScreen';
import { Button } from '@/components/ui';
import { checkApiConnection, describeError, getBrowserOrigin, type ConnectionReport } from '@/lib/client';
import { useAuth } from '@/state/AuthProvider';
import { useTheme } from '@/state/ThemeProvider';
export default function Connection() {
  const auth = useAuth(); const { common } = useTheme();
  const [input, setUrl] = useState<string | null>(null); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [report, setReport] = useState<ConnectionReport | null>(null);
  const url = input ?? auth.baseUrl;
  const browserOrigin = getBrowserOrigin();
  const check = async () => {
    setChecking(true); setMessage(''); setReport(null);
    try { setReport(await checkApiConnection(url)); }
    catch (error) { setMessage(describeError(error)); }
    finally { setChecking(false); }
  };
  return <AppScreen title="Your connection" subtitle="Connect to your own GigaCode API. Drafts stay here, even when the server is offline." protected={false}>
    <Card title="API server"><Field label="Full API origin" value={url} onChangeText={value => { setUrl(value); setReport(null); setMessage(''); }} editable={!busy && !checking} placeholder="https://your-codespace-3000.app.github.dev" keyboardType="url" autoComplete="url" />
      <Text selectable style={common.muted}>Saved API: {auth.baseUrl || '(not configured)'}</Text>
      {browserOrigin && <Text selectable style={common.muted}>Browser origin: {browserOrigin}{'\n'}The API’s WEB_ORIGIN must include this exact value.</Text>}
      <Text style={common.muted}>Changing servers signs you out first. Only connect to a server you trust: it receives your password and submitted code. Use HTTPS remotely. Local HTTP is development-only and may require native transport configuration.</Text>
      <Button label={checking ? 'Checking API…' : 'Check connection'} disabled={busy || checking || !auth.ready || !url.trim()} onPress={() => { void check(); }} />
      {!!message && <Text selectable accessibilityRole="alert" style={common.text}>{message}</Text>}
      <Text style={common.muted}>Checks the URL above without saving it or sending credentials. A successful check confirms API readiness and browser access, not worker execution.</Text>
      {report && <Text selectable style={common.text}>{report.url}{'\n'}HTTP {report.httpStatus} · {report.readiness}{'\n'}PostgreSQL: {report.postgres} · Redis: {report.redis} · Storage: {report.s3}</Text>}
      <Button label={busy ? 'Saving…' : 'Save server & sign out'} variant="primary" disabled={busy || checking || !auth.ready} onPress={() => { setBusy(true); setMessage(''); void auth.setServer(url).then(() => setMessage('Server saved. Use Check connection, then sign in.')).catch(err => setMessage(describeError(err))).finally(() => setBusy(false)); }} />
      <Button label="Sign in" href="/login" />
    </Card>
    <Card title="Codespaces"><Text selectable style={common.muted}>Set EXPO_PUBLIC_API_URL to the complete forwarded port 3000 HTTPS origin, not localhost, the web frontend, or a /v1 path. The API port must be reachable without GitHub’s forwarding login. Expo web additionally needs its exact origin allowed by API CORS. Native cannot reach your computer through localhost.</Text></Card>
    <Button label="Sign out / remove stored session" disabled={busy || checking} onPress={() => { setBusy(true); void auth.logout().then(() => setMessage('Session removed from this client.')).catch(err => setMessage(describeError(err))).finally(() => setBusy(false)); }} />
  </AppScreen>;
}
