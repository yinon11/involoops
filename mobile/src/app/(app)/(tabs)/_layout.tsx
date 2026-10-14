import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useSession } from "@/hooks/use-session";
import { strings } from "@/constants/copy";
import { brand } from "@/theme";

export default function TabLayout() {
  const { session } = useSession();
  const t = strings(session?.user.locale ?? "en");

  return (
    <NativeTabs tintColor={brand.violet}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf="house.fill" md="home" />
        <NativeTabs.Trigger.Label>{t.home}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="income">
        <NativeTabs.Trigger.Icon sf="arrow.up.circle.fill" md="trending_up" />
        <NativeTabs.Trigger.Label>{t.income}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="expenses">
        <NativeTabs.Trigger.Icon sf="arrow.down.circle.fill" md="receipt_long" />
        <NativeTabs.Trigger.Label>{t.expenses}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="more">
        <NativeTabs.Trigger.Icon sf="ellipsis.circle.fill" md="menu" />
        <NativeTabs.Trigger.Label>{t.more}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
