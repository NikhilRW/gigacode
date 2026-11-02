import { useState } from 'react';
import { Text } from 'react-native';
import { AppScreen, Card, Field } from '@/components/AppScreen';
import { Button, Notice } from '@/components/ui';
import { describeError } from '@/lib/client';
import { useAuth } from '@/state/AuthProvider';
import { useTheme } from '@/state/ThemeProvider';
export default function Connection() {
  const auth = useAuth(); const { common } = useTheme();
  const [input, setUrl] = useState<string | null>(null); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const url = input ?? auth.baseUrl;
  return <AppScreen title="Your connection" subtitle="Connect to your own GigaCode API. Drafts stay here, even when the server is offline." protected={false}>
    <Card title="API server"><Field label="Full API origin" value={url} onChangeText={setUrl} placeholder="https://your-codespace-3000.app.github.dev" keyboardType="url" autoComplete="url" />
      <Text style={common.muted}>Changing servers signs you out first. Only connect to a server you trust: it receives your password and submitted code. Use HTTPS remotely. Local HTTP is development-only and may require native transport configuration.</Text>
      <Button label={busy ? 'Saving…' : 'Save server & sign out'} variant="primary" disabled={busy || !auth.ready} onPress={() => { setBusy(true); setMessage(''); void auth.setServer(url).then(() => setMessage('Server saved. Sign in to verify the authenticated connection.')).catch(err => setMessage(describeError(err))).finally(() => setBusy(false)); }} />
      <Button label="Sign in" href="/login" />
    </Card>
    <Card title="Codespaces"><Text selectable style={common.muted}>Set EXPO_PUBLIC_API_URL to the complete forwarded port 3000 HTTPS origin, not localhost, the web frontend, or a /v1 path. The API port must be reachable without GitHub’s forwarding login. Expo web additionally needs its exact origin allowed by API CORS. Native cannot reach your computer through localhost.</Text></Card>
    <Button label="Sign out / remove stored session" disabled={busy} onPress={() => { setBusy(true); void auth.logout().then(() => setMessage('Session removed from this client.')).catch(err => setMessage(describeError(err))).finally(() => setBusy(false)); }} />
    {!!message && <Notice>{message}</Notice>}
  </AppScreen>;
}
