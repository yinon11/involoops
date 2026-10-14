import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { strings } from "@/constants/copy";
import { InvoicePreview } from "@/components/invoice-preview";
import { useSession } from "@/hooks/use-session";
import { ApiProblem, apiJson, idempotencyKey } from "@/utils/api";
import { ActionButton } from "@/components/action-button";
import { TextField } from "@/components/text-field";
import { brand, usePalette } from "@/theme";

interface Expense {
  id: string;
  vendor_name: string | null;
  suggested_vendor_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  amount: string;
  currency: string | null;
  vat_amount: string | null;
  preview_url: string | null;
  status: string;
}

export default function ExpenseReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useSession();
  const t = strings(session?.user.locale ?? "en");
  const colors = usePalette();
  const [expense, setExpense] = useState<Expense | null>(null);
  const [vendor, setVendor] = useState("");
  const [number, setNumber] = useState("");
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("ILS");
  const [vat, setVat] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiJson<Expense>(`/api/v1/invoices/${id}`)
      .then((row) => {
        if (cancelled) return;
        setExpense(row);
        setVendor(row.vendor_name || row.suggested_vendor_name || "");
        setNumber(row.invoice_number ?? "");
        setDate(row.invoice_date ?? "");
        setAmount(row.amount ?? "");
        setCurrency(row.currency ?? "ILS");
        setVat(row.vat_amount ?? "");
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiProblem ? err.message : t.error);
      });
    return () => {
      cancelled = true;
    };
  }, [id, t.error]);

  async function saveAnd(action: "approve" | "reject") {
    if (pending || !id) return;
    setPending(true);
    setError(null);
    try {
      const body: Record<string, string | null> = {
        vendor_name: vendor,
        invoice_number: number,
        amount,
        currency: currency.toUpperCase(),
        vat_amount: vat || null,
      };
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) body.invoice_date = date;
      await apiJson(`/api/v1/invoices/${id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey(),
        },
        body: JSON.stringify(body),
      });
      if (action === "approve") {
        await apiJson(`/api/v1/invoices/${id}/approve`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": idempotencyKey(),
          },
          body: JSON.stringify({ vendor_name: vendor }),
        });
      } else {
        await apiJson(`/api/v1/invoices/${id}/reject`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": idempotencyKey(),
          },
          body: JSON.stringify({ reason: reason.trim() || t.reject }),
        });
      }
      router.replace("/");
    } catch (err) {
      setError(err instanceof ApiProblem ? err.message : t.error);
    } finally {
      setPending(false);
    }
  }

  if (!expense && !error) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={brand.violet} />
      </View>
    );
  }

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 32 }}
    >
      {expense?.preview_url ? (
        <InvoicePreview url={expense.preview_url} failedLabel={t.previewFailed} />
      ) : null}
      <TextField label={t.vendor} value={vendor} onChangeText={setVendor} editable={expense?.status === "pending"} />
      <TextField label={t.invoiceNumber} value={number} onChangeText={setNumber} editable={expense?.status === "pending"} />
      <TextField label={t.date} value={date} onChangeText={setDate} editable={expense?.status === "pending"} />
      <TextField label={t.amount} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" editable={expense?.status === "pending"} />
      <TextField label={t.currency} value={currency} onChangeText={setCurrency} autoCapitalize="characters" editable={expense?.status === "pending"} />
      <TextField label={t.vat} value={vat} onChangeText={setVat} keyboardType="decimal-pad" editable={expense?.status === "pending"} />
      {expense?.status === "pending" ? (
        <TextField label={t.rejectReason} value={reason} onChangeText={setReason} />
      ) : null}
      {error ? (
        <Text selectable style={{ color: colors.destructive }}>
          {error}
        </Text>
      ) : null}
      {expense?.status === "pending" ? (
        <>
          <ActionButton label={pending ? t.loading : t.approve} onPress={() => void saveAnd("approve")} disabled={pending} />
          <ActionButton variant="danger" label={t.reject} onPress={() => void saveAnd("reject")} disabled={pending} />
        </>
      ) : null}
    </ScrollView>
  );
}
