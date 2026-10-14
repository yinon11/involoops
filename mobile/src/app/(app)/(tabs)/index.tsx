import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { strings } from "@/constants/copy";
import { useSession } from "@/hooks/use-session";
import { useDashboard } from "@/hooks/use-dashboard";
import { readOutbox, uploadExpenseFile, dropOutboxItem, type OutboxItem } from "@/utils/expenses";
import { formatMoney, percentChange } from "@/utils/format";
import { Logo } from "@/components/logo";
import { SectionCard } from "@/components/section-card";
import { DeltaChip } from "@/components/delta-chip";
import { CashFlowChart } from "@/components/charts/cash-flow-chart";
import { DonutChart } from "@/components/charts/donut-chart";
import { RankBars } from "@/components/charts/rank-bars";
import { brand, usePalette } from "@/theme";

export default function HomeScreen() {
  const router = useRouter();
  const { session } = useSession();
  const locale = session?.user.locale ?? "en";
  const t = strings(locale);
  const colors = usePalette();
  const { top } = useSafeAreaInsets();
  const { dash, error, refreshing, refresh } = useDashboard();
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const firstName = (session?.user.name ?? "").trim().split(/\s+/)[0] ?? "";

  useFocusEffect(
    useCallback(() => {
      void readOutbox().then(setOutbox);
    }, []),
  );

  async function retry(item: OutboxItem) {
    if (retrying) return;
    setRetrying(true);
    setRetryError(null);
    try {
      const invoiceId = await uploadExpenseFile(item);
      await dropOutboxItem(item.id);
      router.push(`/expense/${invoiceId}`);
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : t.error);
    } finally {
      setRetrying(false);
    }
  }

  const currency = dash?.currency ?? "ILS";
  const money = (amount: number) => formatMoney(amount, currency, locale);
  const previousNet = dash ? dash.previous_money_in - dash.previous_money_out : 0;

  const vendorTop = dash?.top_vendors ?? [];
  const vendorTopTotal = vendorTop.reduce((sum, row) => sum + row.total, 0);
  const vendorOther = Math.max(0, (dash?.year_money_out ?? 0) - vendorTopTotal);

  const attention = dash
    ? [
        dash.pending_count > 0
          ? {
              key: "pending",
              count: String(dash.pending_count),
              label: t.pending,
              color: colors.warning,
              background: colors.warningSoft,
              onPress: () => router.push("/pending"),
            }
          : null,
        dash.unpaid_count > 0
          ? {
              key: "unpaid",
              count: money(dash.unpaid_total),
              label: t.unpaid,
              color: colors.info,
              background: colors.infoSoft,
              onPress: () => router.push("/documents"),
            }
          : null,
        dash.duplicate_count > 0
          ? {
              key: "duplicates",
              count: String(dash.duplicate_count),
              label: t.duplicates,
              color: colors.expense,
              background: colors.expenseSoft,
              onPress: () => router.push("/duplicates"),
            }
          : null,
      ].filter((chip): chip is NonNullable<typeof chip> => chip !== null)
    : [];

  return (
    <ScrollView
      contentContainerStyle={{ paddingTop: top + 12, paddingHorizontal: 20, paddingBottom: 28, gap: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={brand.violet} />}
    >
      <Logo />
      <Text style={{ color: colors.label, fontSize: 28, fontWeight: "700" }}>
        {firstName ? `${t.hello}, ${firstName}` : t.hello}
      </Text>
      {error ? (
        <Text selectable style={{ color: colors.destructive }}>
          {error}
        </Text>
      ) : null}
      {dash === null && !error ? <ActivityIndicator color={brand.violet} /> : null}
      {dash ? (
        <>
          <HeroCard
            title={t.thisMonth}
            netLabel={t.net}
            net={money(dash.net)}
            netDelta={percentChange(dash.net, previousNet)}
          />
          <View style={{ flexDirection: "row", gap: 12 }}>
            <StatCard
              label={t.moneyIn}
              value={money(dash.money_in)}
              delta={percentChange(dash.money_in, dash.previous_money_in)}
              goodWhenUp
              color={colors.income}
              background={colors.incomeSoft}
            />
            <StatCard
              label={t.moneyOut}
              value={money(dash.money_out)}
              delta={percentChange(dash.money_out, dash.previous_money_out)}
              goodWhenUp={false}
              color={colors.expense}
              background={colors.expenseSoft}
            />
          </View>
          {attention.length > 0 ? (
            <View style={{ gap: 10 }}>
              <Text style={{ color: colors.label, fontSize: 16, fontWeight: "700" }}>{t.needsAttention}</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                {attention.map((chip) => (
                  <Pressable
                    key={chip.key}
                    onPress={chip.onPress}
                    style={({ pressed }) => ({
                      flexGrow: 1,
                      minWidth: "30%",
                      backgroundColor: chip.background,
                      borderRadius: 16,
                      borderCurve: "continuous",
                      padding: 12,
                      gap: 2,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Text
                      selectable
                      numberOfLines={1}
                      style={{ color: chip.color, fontSize: 17, fontWeight: "800", fontVariant: ["tabular-nums"] }}
                    >
                      {chip.count}
                    </Text>
                    <Text numberOfLines={2} style={{ color: chip.color, fontSize: 12, fontWeight: "600" }}>
                      {chip.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
          {dash.months.length > 0 ? (
            <SectionCard title={`${t.cashFlow} · ${t.lastSixMonths}`}>
              <CashFlowChart
                months={dash.months}
                currency={currency}
                locale={locale}
                inLabel={t.moneyIn}
                outLabel={t.moneyOut}
              />
            </SectionCard>
          ) : null}
          {vendorTop.length > 0 ? (
            <SectionCard title={t.spentWith} action={t.allVendors} onAction={() => router.push("/vendors")}>
              <DonutChart
                currency={currency}
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
          {dash.top_customers.length > 0 ? (
            <SectionCard title={t.owed} action={t.allDocuments} onAction={() => router.push("/documents")}>
              <RankBars
                currency={currency}
                locale={locale}
                rows={dash.top_customers.map((row) => ({
                  label: row.name,
                  value: row.total,
                  hint: `${row.count} ${t.invoiceCount}`,
                  onPress: () => router.push("/documents"),
                }))}
              />
            </SectionCard>
          ) : null}
        </>
      ) : null}
      {outbox.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.label, fontSize: 20, fontWeight: "700" }}>{t.outbox}</Text>
          {retryError ? (
            <Text selectable style={{ color: colors.destructive }}>
              {retryError}
            </Text>
          ) : null}
          {outbox.map((item) => (
            <View key={item.id} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <Text style={{ flex: 1, color: colors.label }} numberOfLines={1}>
                {item.name}
              </Text>
              <Pressable disabled={retrying} onPress={() => void retry(item)} hitSlop={8}>
                <Text style={{ color: brand.violet, fontWeight: "600" }}>{retrying ? t.loading : t.retry}</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

function HeroCard({
  title,
  netLabel,
  net,
  netDelta,
}: {
  title: string;
  netLabel: string;
  net: string;
  netDelta: number | null;
}) {
  return (
    <View
      style={{
        backgroundColor: brand.violet,
        borderRadius: 22,
        borderCurve: "continuous",
        padding: 18,
        gap: 6,
      }}
    >
      <Text style={{ color: brand.onViolet, opacity: 0.8, fontSize: 13, fontWeight: "600" }}>
        {title} · {netLabel}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Text
          selectable
          style={{ color: brand.onViolet, fontSize: 32, fontWeight: "800", fontVariant: ["tabular-nums"] }}
        >
          {net}
        </Text>
        <DeltaChip percent={netDelta} goodWhenUp onDark />
      </View>
    </View>
  );
}

function StatCard({
  label,
  value,
  delta,
  goodWhenUp,
  color,
  background,
}: {
  label: string;
  value: string;
  delta: number | null;
  goodWhenUp: boolean;
  color: string;
  background: string;
}) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: background,
        borderRadius: 18,
        borderCurve: "continuous",
        padding: 14,
        gap: 4,
      }}
    >
      <Text numberOfLines={1} style={{ color, fontSize: 12, fontWeight: "600", opacity: 0.85 }}>
        {label}
      </Text>
      <Text
        selectable
        numberOfLines={1}
        style={{ color, fontSize: 19, fontWeight: "800", fontVariant: ["tabular-nums"] }}
      >
        {value}
      </Text>
      <DeltaChip percent={delta} goodWhenUp={goodWhenUp} onTint />
    </View>
  );
}
