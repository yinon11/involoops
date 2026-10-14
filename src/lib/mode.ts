import { cookies } from "next/headers";

export const APP_MODES = ["expense", "creator", "admin"] as const;
export type AppMode = (typeof APP_MODES)[number];

export const MODE_COOKIE_NAME = "involoops_mode";
const ONE_YEAR = 60 * 60 * 24 * 365;

export function isAppMode(value: unknown): value is AppMode {
  return (
    typeof value === "string" &&
    (APP_MODES as readonly string[]).includes(value)
  );
}

export async function readMode(): Promise<AppMode> {
  const c = await cookies();
  const raw = c.get(MODE_COOKIE_NAME)?.value;
  return isAppMode(raw) ? raw : "expense";
}

export async function writeMode(mode: AppMode): Promise<void> {
  const c = await cookies();
  c.set(MODE_COOKIE_NAME, mode, {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: ONE_YEAR,
  });
}

/** Per-mode landing route. */
export const MODE_LANDING: Record<AppMode, string> = {
  expense: "/",
  creator: "/money-in",
  admin: "/admin",
};
