"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getPendingInvoiceCount } from "@/features/expenses/actions/invoice-actions";

type PendingCountContextValue = {
  count: number;
  refresh: () => Promise<void>;
};

const PendingCountContext = createContext<PendingCountContextValue | null>(
  null,
);

/**
 * Holds the count of pending invoices used by the nav badge.
 *
 * Concurrency: multiple uploads may complete roughly simultaneously and each
 * triggers a refresh. Responses may arrive out of order, so we tag every
 * refresh with a monotonically increasing id and only apply a response if it
 * is newer than the most recently applied one. The final state always
 * reflects the authoritative server count (DB is the source of truth), so
 * simultaneous uploads converge correctly.
 */
export function PendingCountProvider({
  initialCount,
  children,
}: {
  initialCount: number;
  children: ReactNode;
}) {
  const [count, setCount] = useState(initialCount);
  const requestCounterRef = useRef(0);
  const lastAppliedRef = useRef(0);

  // Re-seed if the server-provided initial count changes across navigations.
  // The counter refs are monotonic and deliberately NOT reset here: in-flight
  // refresh responses that return after a reseed will have a higher id than
  // `lastAppliedRef` and still apply correctly.
  useEffect(() => {
    setCount(initialCount);
  }, [initialCount]);

  const refresh = useCallback(async () => {
    const id = ++requestCounterRef.current;
    try {
      const next = await getPendingInvoiceCount();
      if (id > lastAppliedRef.current) {
        lastAppliedRef.current = id;
        setCount(next);
      }
    } catch {
      // Swallow — the badge will be corrected on the next refresh or navigation.
    }
  }, []);

  const value = useMemo(() => ({ count, refresh }), [count, refresh]);

  return (
    <PendingCountContext.Provider value={value}>
      {children}
    </PendingCountContext.Provider>
  );
}

export function usePendingCount() {
  const ctx = useContext(PendingCountContext);
  if (!ctx) {
    throw new Error(
      "usePendingCount must be used within a PendingCountProvider",
    );
  }
  return ctx;
}
