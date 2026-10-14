import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { loadSession, type Session } from "@/utils/session";
import { logout as logoutRequest } from "@/utils/api";

interface SessionContextValue {
  ready: boolean;
  session: Session | null;
  setSession: (session: Session | null) => void;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadSession()
      .then((stored) => {
        if (!cancelled) setSession(stored);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = useCallback(async () => {
    await logoutRequest();
    setSession(null);
  }, []);

  const value = useMemo(
    () => ({ ready, session, setSession, signOut }),
    [ready, session, signOut],
  );

  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession(): SessionContextValue {
  const value = use(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
