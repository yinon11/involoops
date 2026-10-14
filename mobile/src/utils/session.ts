import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const KEY = "involoops.session";

function browserStorage(): Storage | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  locale: "en" | "he";
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when the access token should be refreshed. */
  expiresAt: number;
  user: SessionUser;
}

async function readRaw(): Promise<string | null> {
  if (Platform.OS === "web") return browserStorage()?.getItem(KEY) ?? null;
  return SecureStore.getItemAsync(KEY);
}

async function writeRaw(value: string): Promise<void> {
  if (Platform.OS === "web") {
    browserStorage()?.setItem(KEY, value);
    return;
  }
  await SecureStore.setItemAsync(KEY, value);
}

async function deleteRaw(): Promise<void> {
  if (Platform.OS === "web") {
    browserStorage()?.removeItem(KEY);
    return;
  }
  await SecureStore.deleteItemAsync(KEY);
}

export async function loadSession(): Promise<Session | null> {
  const raw = await readRaw();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export async function saveSession(session: Session): Promise<void> {
  await writeRaw(JSON.stringify(session));
}

export async function clearSession(): Promise<void> {
  await deleteRaw();
}
