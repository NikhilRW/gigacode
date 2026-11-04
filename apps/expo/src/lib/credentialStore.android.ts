import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';
import type { Credential } from './client';

// Android keeps its existing Keystore-backed session. Metro selects this module
// only on Android; the iOS/browser module never imports SecureStore.
const key = 'gigacode.session.v1';
const schema = z.object({ token: z.string().startsWith('ce_session_'), expiresAt: z.number().finite(), baseUrl: z.string() });
export const credentialStorageDescription = 'Android sessions use SecureStore.';

export async function readCredential(): Promise<Credential | null> {
  const raw = await SecureStore.getItemAsync(key);
  if (!raw) return null;
  const result = schema.safeParse(JSON.parse(raw));
  return result.success && result.data.expiresAt > Date.now() ? result.data : null;
}

export async function writeCredential(value: Credential | null): Promise<void> {
  if (value) await SecureStore.setItemAsync(key, JSON.stringify(value));
  else await SecureStore.deleteItemAsync(key);
}
