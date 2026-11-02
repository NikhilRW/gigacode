import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Text, View } from 'react-native';
import { AppScreen, Card, Field, FlowRow, ResourceState } from '@/components/AppScreen';
import { Button, Notice } from '@/components/ui';
import { useGet } from '@/lib/useResource';
import type { ApiKey } from '@/lib/types';
import { useAuth } from '@/state/AuthProvider';
import { useTheme } from '@/state/ThemeProvider';
import { describeError } from '@/lib/client';
import { mono } from '@/theme';
export default function Keys() { return <AppScreen title="API keys" subtitle="Create keys for your own scripts and CI. The app itself uses your user session, never an embedded API key."><KeyManager /></AppScreen>; }
function KeyManager() {
  const { api, baseUrl } = useAuth(); const { colors, common } = useTheme();
  const keys = useGet<{ items: ApiKey[] }>('/v1/api-keys');
  const [name, setName] = useState(''); const [secret, setSecret] = useState<string | null>(null); const [revoke, setRevoke] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  useFocusEffect(useCallback(() => () => setSecret(null), []));
  const create = async () => {
    setBusy(true); setMessage(''); setSecret(null);
    try {
      if (!name.trim() || name.trim().length > 80) throw new Error('Give the key a name of 1–80 characters.');
      const response = await api.request<ApiKey & { key: string }>('POST', '/v1/api-keys', { body: { name: name.trim() } });
      setSecret(response.key); setName(''); keys.reload();
    } catch (err) { setMessage(describeError(err)); } finally { setBusy(false); }
  };
  const confirmRevoke = async () => {
    if (!revoke) return;
    setBusy(true); setMessage('');
    try { await api.request('DELETE', `/v1/api-keys/${encodeURIComponent(revoke)}`); setRevoke(null); setMessage('Key revoked.'); keys.reload(); }
    catch (err) { setMessage(describeError(err)); } finally { setBusy(false); }
  };
  return <>
    <Card title="Create a key"><Field label="Key name" placeholder="My local script" value={name} onChangeText={setName} maxLength={80} /><Button label={busy ? 'Working…' : 'Create API key'} variant="primary" disabled={busy} onPress={() => { void create(); }} /></Card>
    {secret && <Card title="Shown only once"><Notice>Select and copy this key now. It is never persisted by the app and is hidden when leaving this screen.</Notice><Text selectable style={{ color: colors.accent, fontFamily: mono, fontSize: 17, lineHeight: 27 }}>{secret}</Text><Button label="I saved it · hide key" onPress={() => setSecret(null)} /></Card>}
    {!!message && <Notice>{message}</Notice>}
    <Card title="Your keys"><ResourceState resource={keys} empty={keys.data?.items.length === 0} />{keys.data?.items.map(key => <View key={key.id} style={{ gap: 9, paddingVertical: 12, borderBottomWidth: 1, borderColor: colors.border }}>
      <Text style={common.text}>{key.name}{key.revokedAt ? ' · revoked' : ''}</Text><Text selectable style={common.muted}>{key.prefix}… · created {new Date(key.createdAt).toLocaleString()} · last used {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : 'never'}</Text>
      {!key.revokedAt && <Button label={`Revoke ${key.name}`} disabled={busy} onPress={() => setRevoke(key.id)} />}
      {revoke === key.id && <><Notice>This permanently revokes this key. Clients using it will stop working.</Notice><FlowRow><Button label="Confirm revoke" disabled={busy} onPress={() => { void confirmRevoke(); }} /><Button label="Keep key" disabled={busy} onPress={() => setRevoke(null)} /></FlowRow></>}
    </View>)}</Card>
    <Card title="Use your key outside the app"><Text style={common.muted}>Set GIGACODE_API_KEY privately in your terminal. Never paste it into EXPO_PUBLIC variables, source code, screenshots, or shared logs.</Text><Text selectable style={{ fontFamily: mono, color: colors.text, fontSize: 15, lineHeight: 23 }}>{`curl '${baseUrl}/v1/usage' \\\n  -H "Authorization: Bearer $GIGACODE_API_KEY"`}</Text></Card>
  </>;
}
