import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';
import type { Credential } from './client';
const key = 'gigacode.session.v1';
const schema = z.object({
  token: z.string().startsWith('ce_session_'),
  expiresAt: z.number().finite(),
  baseUrl: z.string(),
});
export const credentialStorageDescription =
  'iOS sessions use basic device storage (AsyncStorage, unencrypted). Browser sessions use this tab’s sessionStorage.';
export async function readCredential(): Promise<Credential | null> {
  const raw =
    Platform.OS === 'web'
      ? typeof sessionStorage === 'undefined'
        ? null
        : sessionStorage.getItem(key)
      : await AsyncStorage.getItem(key);
  if (!raw) return null;
  const result = schema.safeParse(JSON.parse(raw));
  return result.success && result.data.expiresAt > Date.now() ? result.data : null;
}
export async function writeCredential(value: Credential | null) {
  if (Platform.OS === 'web') {
    // No localStorage: closing the browser tab ends this client-side session.
    if (typeof sessionStorage !== 'undefined') {
      if (value) sessionStorage.setItem(key, JSON.stringify(value));
      else sessionStorage.removeItem(key);
    }
  } else if (value) await AsyncStorage.setItem(key, JSON.stringify(value));
  else await AsyncStorage.removeItem(key);
}
