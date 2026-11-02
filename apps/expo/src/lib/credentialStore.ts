import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';
import type { Credential } from './client';
const key = 'gigacode.session.v1';
const schema = z.object({ token: z.string().startsWith('ce_session_'), expiresAt: z.number().finite(), baseUrl: z.string() });
export async function readCredential(): Promise<Credential | null> {
  const raw = Platform.OS === 'web' ? (typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(key)) : await SecureStore.getItemAsync(key);
  if (!raw) return null;
  const result = schema.safeParse(JSON.parse(raw));
  return result.success && result.data.expiresAt > Date.now() ? result.data : null;
}
export async function writeCredential(value: Credential | null) {
  if (Platform.OS === 'web') {
    // No localStorage: closing the browser tab ends this client-side session.
    if (typeof sessionStorage !== 'undefined') { if (value) sessionStorage.setItem(key, JSON.stringify(value)); else sessionStorage.removeItem(key); }
  } else if (value) await SecureStore.setItemAsync(key, JSON.stringify(value), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  else await SecureStore.deleteItemAsync(key);
}
