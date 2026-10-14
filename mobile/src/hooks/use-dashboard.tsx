import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { strings } from "@/constants/copy";
import { useSession } from "@/hooks/use-session";
import { ApiProblem, apiJson } from "@/utils/api";

export interface DashboardMonth {
  month: string;
  money_in: number;
  money_out: number;
}

export interface Dashboard {
  currency: string;
  month: string;
  money_in: number;
  money_out: number;
  previous_money_in: number;
  previous_money_out: number;
  net: number;
  year_money_in: number;
  year_money_out: number;
  pending_count: number;
  duplicate_count: number;
  unpaid_count: number;
  unpaid_total: number;
  months: DashboardMonth[];
  top_vendors: { id: string | null; name: string; total: number }[];
  top_customers: { name: string; total: number; count: number }[];
}

/** Fetches `/api/v1/dashboard` on focus; `refresh` backs pull-to-refresh. */
export function useDashboard() {
  const { session } = useSession();
  const t = strings(session?.user.locale ?? "en");
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const body = await apiJson<Dashboard>("/api/v1/dashboard");
      // A server from before the chart release has no months series yet.
      setDash({ ...body, months: body.months ?? [] });
    } catch (err) {
      setError(err instanceof ApiProblem ? err.message : t.error);
    }
  }, [t.error]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  return { dash, error, refreshing, refresh, reload: load };
}
