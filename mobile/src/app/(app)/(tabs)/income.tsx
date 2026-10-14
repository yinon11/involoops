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
import { RankBars } from "@/components/charts/rank-bars";
import { formatMoney } from "@/utils/format";
import { brand, usePalette } from "@/theme";

export default function IncomeScreen() {
  const router = useRouter();
  const { session } = useSession();
  const locale = session?.user.locale ?? "en";
  const t = strings(locale);
  const colors = usePalette();
  const { top } = useSafeAreaInsets();
  const { dash, error, refreshing, refresh } = useDashboard();

  const hasIncome = dash ? dash.months.some((row) => row.money_in > 0) : false;

  return (
    <ScrollView
      contentContainerStyle={{ paddingTop: top + 16, paddingHorizontal: 20, paddingBottom: 32, gap: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={brand.violet} />}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Text style={{ flex: 1, color: colors.label, fontSize: 34, fontWeight: "700" }}>{t.income}</Text>
        <AddButton label={t.sendInvoice} onPress={() => router.push("/invoice/new")} />
      </View>
      {error ? (
        <Text selectable style={{ color: colors.destructive }}>
          {error}
        </Text>
      ) : null}
      {dash === null && !error ? <ActivityIndicator color={brand.violet} /> : null}
      {dash ? (
        <SectionCard title={`${t.moneyIn} · ${t.lastSixMonths}`}>
          {hasIncome ? (
            <CashFlowChart
              months={dash.months}
              currency={dash.currency}
              locale={locale}
              series="in"
              inLabel={t.moneyIn}
              outLabel={t.moneyOut}
            />
          ) : (
            <Text style={{ color: colors.secondaryLabel, fontSize: 14, lineHeight: 20 }}>{t.noChartData}</Text>
          )}
        </SectionCard>
      ) : null}
      {dash && dash.top_customers.length > 0 ? (
        <SectionCard title={t.owed} action={t.allDocuments} onAction={() => router.push("/documents")}>
          <RankBars
            currency={dash.currency}
            locale={locale}
            color={colors.income}
            rows={dash.top_customers.map((row) => ({
              label: row.name,
              value: row.total,
              hint: `${row.count} ${t.invoiceCount}`,
              onPress: () => router.push("/documents"),
            }))}
          />
        </SectionCard>
      ) : null}
      <MenuGroup
        items={[
          {
            label: t.documents,
            hint: t.documentsHint,
            detail:
              dash && dash.unpaid_count > 0
                ? `${t.unpaid} · ${formatMoney(dash.unpaid_total, dash.currency, locale)}`
                : undefined,
            onPress: () => router.push("/documents"),
          },
          { label: t.customers, hint: t.customersHint, onPress: () => router.push("/customers") },
          { label: t.sendInvoice, hint: t.issueHint, onPress: () => router.push("/invoice/new") },
        ]}
      />
    </ScrollView>
  );
}
