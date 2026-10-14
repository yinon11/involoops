import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { strings } from "@/constants/copy";
import { useSession } from "@/hooks/use-session";
import { useDashboard } from "@/hooks/use-dashboard";
import { MenuGroup } from "@/components/menu-group";
import { AddButton } from "@/components/add-button";
import { SectionCard } from "@/components/section-card";
import { CashFlowChart } from "@/components/charts/cash-flow-chart";
import { DonutChart } from "@/components/charts/donut-chart";
import { brand, usePalette } from "@/theme";

export default function ExpensesScreen() {
  const router = useRouter();
  const { session } = useSession();
  const locale = session?.user.locale ?? "en";
  const t = strings(locale);
  const colors = usePalette();
  const { top } = useSafeAreaInsets();
  const { dash, error, refreshing, refresh } = useDashboard();

  const vendorTop = dash?.top_vendors ?? [];
  const vendorTopTotal = vendorTop.reduce((sum, row) => sum + row.total, 0);
  const vendorOther = Math.max(0, (dash?.year_money_out ?? 0) - vendorTopTotal);
  const hasSpending = dash ? dash.months.some((row) => row.money_out > 0) : false;

  return (
    <ScrollView
      contentContainerStyle={{ paddingTop: top + 16, paddingHorizontal: 20, paddingBottom: 32, gap: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={brand.violet} />}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Text style={{ flex: 1, color: colors.label, fontSize: 34, fontWeight: "700" }}>{t.expenses}</Text>
        <AddButton label={t.addExpense} onPress={() => router.push("/capture")} />
      </View>
      {error ? (
        <Text selectable style={{ color: colors.destructive }}>
          {error}
        </Text>
      ) : null}
      {dash === null && !error ? <ActivityIndicator color={brand.violet} /> : null}
      {dash ? (
        <SectionCard title={`${t.moneyOut} · ${t.lastSixMonths}`}>
          {hasSpending ? (
            <CashFlowChart
              months={dash.months}
              currency={dash.currency}
              locale={locale}
              series="out"
              inLabel={t.moneyIn}
              outLabel={t.moneyOut}
            />
          ) : (
            <Text style={{ color: colors.secondaryLabel, fontSize: 14, lineHeight: 20 }}>{t.noChartData}</Text>
          )}
        </SectionCard>
      ) : null}
      {dash && vendorTop.length > 0 ? (
        <SectionCard title={t.spentWith} action={t.allVendors} onAction={() => router.push("/vendors")}>
          <DonutChart
            currency={dash.currency}
            locale={locale}
            centerLabel={t.thisYear}
            slices={[
              ...vendorTop.map((row) => ({
                label: row.name,
                value: row.total,
                onPress: () => router.push("/vendors"),
              })),
              ...(vendorOther > 0 ? [{ label: t.other, value: vendorOther }] : []),
            ]}
          />
        </SectionCard>
      ) : null}
      <MenuGroup
        items={[
          {
            label: t.pending,
            hint: t.pendingHint,
            detail: dash && dash.pending_count > 0 ? String(dash.pending_count) : undefined,
            onPress: () => router.push("/pending"),
          },
          { label: t.invoices, hint: t.invoicesHint, onPress: () => router.push("/invoices") },
          {
            label: t.duplicates,
            hint: t.duplicatesHint,
            detail: dash && dash.duplicate_count > 0 ? String(dash.duplicate_count) : undefined,
            onPress: () => router.push("/duplicates"),
          },
          { label: t.vendors, hint: t.vendorsHint, onPress: () => router.push("/vendors") },
        ]}
      />
    </ScrollView>
  );
}
