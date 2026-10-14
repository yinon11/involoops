import { Text, View } from "react-native";
import { usePalette } from "@/theme";

/** Colored capsule for invoice/document statuses in list rows. */
export function StatusPill({ status }: { status: string }) {
  const colors = usePalette();
  const tone =
    status === "approved" || status === "paid"
      ? { color: colors.income, background: colors.incomeSoft }
      : status === "pending" || status === "processing" || status === "draft"
        ? { color: colors.warning, background: colors.warningSoft }
        : status === "rejected" || status === "voided"
          ? { color: colors.expense, background: colors.expenseSoft }
          : { color: colors.info, background: colors.infoSoft };

  return (
    <View
      style={{
        alignSelf: "flex-start",
        backgroundColor: tone.background,
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 2,
      }}
    >
      <Text style={{ color: tone.color, fontSize: 11, fontWeight: "700" }}>{status}</Text>
    </View>
  );
}
