import { useState } from 'react';
import { Text } from 'react-native';
import { AppScreen, Card, Field } from '@/components/AppScreen';
import { Button, Notice } from '@/components/ui';
import { useAuth } from '@/state/AuthProvider';
import { useTheme } from '@/state/ThemeProvider';
import { describeError } from '@/lib/client';
import { credentialStorageDescription } from '@/lib/credentialStore';

export default function Account() {
  return (
    <AppScreen
      title="Your account"
      subtitle="Manage your profile and session. Local drafts are independent of your account."
    >
      <AccountForms />
    </AppScreen>
  );
}
function AccountForms() {
  const auth = useAuth();
  const { common } = useTheme();
  const [name, setName] = useState(auth.me?.user.name ?? '');
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const action = async (kind: 'profile' | 'password' | 'logout') => {
    setBusy(true);
    setMessage('');
    try {
      if (kind === 'profile') {
        if (!name.trim() || name.trim().length > 80) throw new Error('Your name must be 1–80 characters.');
        await auth.api.request('PATCH', '/v1/me', { body: { name: name.trim() } });
        await auth.refreshMe();
        setMessage('Profile saved.');
      } else if (kind === 'password') {
        if (
          !currentPassword ||
          currentPassword.length > 200 ||
          newPassword.length < 10 ||
          newPassword.length > 200
        )
          throw new Error('Enter your current password and a new password of 10–200 characters.');
        if (newPassword !== confirm) throw new Error('The new passwords do not match.');
        await auth.api.request('POST', '/v1/me/password', { body: { currentPassword, newPassword } });
        setCurrent('');
        setNew('');
        setConfirm('');
        setMessage('Password changed.');
      } else await auth.logout();
    } catch (err) {
      setMessage(describeError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Card title="Profile">
        <Text selectable style={common.muted}>
          {auth.me?.user.email} · {auth.me?.user.role}
        </Text>
        <Text style={common.muted}>Workspace: {auth.me?.tenant.name}</Text>
        <Field label="Display name" value={name} onChangeText={setName} autoComplete="name" maxLength={80} />
        <Button
          label="Save profile"
          disabled={busy}
          onPress={() => {
            void action('profile');
          }}
          variant="primary"
        />
      </Card>
      <Card title="Change password">
        <Field
          label="Current password"
          value={currentPassword}
          onChangeText={setCurrent}
          secureTextEntry
          autoComplete="current-password"
          maxLength={200}
        />
        <Field
          label="New password · at least 10 characters"
          value={newPassword}
          onChangeText={setNew}
          secureTextEntry
          autoComplete="new-password"
          maxLength={200}
        />
        <Field
          label="Confirm new password"
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
          autoComplete="new-password"
          maxLength={200}
        />
        <Button
          label="Change password"
          disabled={busy}
          onPress={() => {
            void action('password');
          }}
        />
      </Card>
      {!!message && <Notice>{message}</Notice>}
      <Card title="Session">
        <Text style={common.muted}>
          Sign out removes this client’s bearer credential; the server-side session expires at its original
          expiry. {credentialStorageDescription}
        </Text>
        <Button
          label="Sign out on this device"
          disabled={busy}
          onPress={() => {
            void action('logout');
          }}
        />
      </Card>
    </>
  );
}
