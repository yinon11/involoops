import { clearSession, loadSession, saveSession, type Session, type SessionUser } from "@/utils/session";

export const API_BASE = (process.env.EXPO_PUBLIC_API_URL ?? "https://sandbox.involoops.com").replace(/\/$/, "");

export class ApiProblem extends Error {
  status: number;
  code?: string;
  /** Structured extras some errors carry, e.g. SHAAM statutory options. */
  meta?: Record<string, unknown>;

  constructor(message: string, status: number, code?: string, meta?: Record<string, unknown>) {
    super(message);
    this.name = "ApiProblem";
    this.status = status;
    this.code = code;
    this.meta = meta;
  }
}

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  mfa_required?: boolean;
  user: SessionUser | null;
};

function sessionFromTokens(body: TokenResponse, previous: SessionUser | null): Session {
  if (!body.user && !previous) {
    throw new ApiProblem("Sign-in did not return a user", 500);
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + body.expires_in * 1000 - 30_000,
    user: body.user ?? previous!,
  };
}

async function readProblem(response: Response): Promise<ApiProblem> {
  let title = `HTTP ${response.status}`;
  let code: string | undefined;
  let meta: Record<string, unknown> | undefined;
  try {
    const body = (await response.json()) as {
      title?: string;
      detail?: string;
      code?: string;
      meta?: Record<string, unknown>;
    };
    title = body.detail || body.title || title;
    code = body.code;
    meta = body.meta;
  } catch {
    // Non-JSON error body.
  }
  return new ApiProblem(title, response.status, code, meta);
}

export async function login(input: {
  email: string;
  password: string;
  mfaCode?: string;
  deviceName?: string;
}): Promise<{ mfaRequired: true } | { session: Session }> {
  const response = await fetch(apiUrl("/api/v1/auth/login"), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      mfa_code: input.mfaCode,
      device_name: input.deviceName ?? "InvoLoops phone",
    }),
  });
  if (!response.ok) throw await readProblem(response);
  const body = (await response.json()) as TokenResponse;
  if (body.mfa_required) return { mfaRequired: true };
  const session = sessionFromTokens(body, null);
  await saveSession(session);
  return { session };
}

async function refresh(current: Session): Promise<Session> {
  const response = await fetch(apiUrl("/api/v1/auth/refresh"), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ refresh_token: current.refreshToken }),
  });
  if (!response.ok) {
    await clearSession();
    throw await readProblem(response);
  }
  const body = (await response.json()) as TokenResponse;
  const session = sessionFromTokens(body, current.user);
  await saveSession(session);
  return session;
}

let refreshInFlight: Promise<Session> | null = null;

async function validSession(): Promise<Session> {
  const current = await loadSession();
  if (!current) throw new ApiProblem("Sign in required", 401);
  if (current.expiresAt > Date.now()) return current;
  if (!refreshInFlight) {
    refreshInFlight = refresh(current).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const session = await validSession();
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${session.accessToken}`);
  headers.set("accept", "application/json");
  const response = await fetch(apiUrl(path), { ...init, headers });
  if (response.status !== 401) return response;
  const renewed = await refresh(session);
  headers.set("authorization", `Bearer ${renewed.accessToken}`);
  return fetch(apiUrl(path), { ...init, headers });
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) throw await readProblem(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function logout(): Promise<void> {
  const current = await loadSession();
  if (current) {
    await fetch(apiUrl("/api/v1/auth/logout"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: current.refreshToken }),
    }).catch(() => undefined);
  }
  await clearSession();
}

export function idempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
