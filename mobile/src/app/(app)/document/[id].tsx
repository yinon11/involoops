import { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { strings, type Copy } from "@/constants/copy";
import { useSession } from "@/hooks/use-session";
import { ApiProblem, apiJson } from "@/utils/api";
import { formatMoney } from "@/utils/format";
import { ActionButton } from "@/components/action-button";
import { InvoicePreview } from "@/components/invoice-preview";
import { SectionCard } from "@/components/section-card";
import { SendEmailCard } from "@/components/send-email-card";
import { StatusPill } from "@/components/status-pill";
import { brand, usePalette } from "@/theme";

interface DocumentDetail {
  id: string;
  formatted_number: string | null;
  draft_reference: string | null;
  document_type: string;
  customer_id: string | null;
  invoice_date: string;
  due_date: string | null;
  items: { description: string; quantity: number; unitPrice: number; total: number }[];
  subtotal: string | null;
  vat_rate: string | null;
  vat_amount: string | null;
  total: string | null;
  currency: string | null;
  notes: string | null;
  status: string;
  allocation_number: string | null;
}

function docTypeLabel(type: string, t: Copy): string {
  switch (type) {
    case "TAX_INVOICE":
      return t.docTaxInvoice;
    case "TAX_INVOICE_RECEIPT":
      return t.docTaxInvoiceReceipt;
    case "RECEIPT":
      return t.docReceipt;
    case "PROFORMA":
      return t.docProforma;
    case "DELIVERY_NOTE":
      return t.docDeliveryNote;
    case "CREDIT_INVOICE":
      return t.docCreditInvoice;
    default:
      return type;
  }
}

export default function DocumentScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const { session } = useSession();
  const locale = session?.user.locale ?? "en";
  const t = strings(locale);
  const colors = usePalette();
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [customerEmail, setCustomerEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const detail = await apiJson<DocumentDetail>(`/api/v1/outbound-invoices/${id}`);
      setDoc(detail);
      // Drafts have no PDF yet — the 404 is expected, not an error.
      apiJson<{ url: string }>(`/api/v1/outbound-invoices/${id}/pdf`)
        .then((link) => setPdfUrl(`${link.url}&preview=1`))
        .catch(() => setPdfUrl(null));
      if (detail.customer_id) {
        apiJson<{ email: string | null }>(`/api/v1/customers/${detail.customer_id}`)
          .then((customer) => setCustomerEmail(customer.email ?? ""))
          .catch(() => undefined);
      }
    } catch (err) {
      setError(err instanceof ApiProblem ? err.message : t.error);
    }
  }, [id, t.error]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function share() {
    if (!doc || sharing) return;
    setSharing(true);
    try {
      // Mint a fresh link — the preview's one may have expired (5 min TTL).
      const link = await apiJson<{ url: string }>(`/api/v1/outbound-invoices/${doc.id}/pdf`);
      const file = await File.downloadFileAsync(link.url, new File(Paths.cache, `${doc.id}.pdf`), {
        idempotent: true,
      });
      await Sharing.shareAsync(file.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
    } catch (err) {
      setError(err instanceof ApiProblem ? err.message : t.error);
    } finally {
      setSharing(false);
    }
  }

  if (doc === null && !error) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={brand.violet} />
      </View>
    );
  }

  const currency = doc?.currency ?? "ILS";
  const money = (value: string | number | null) =>
    value == null ? "—" : formatMoney(Number(value), currency, locale);
  const number = doc?.formatted_number ?? doc?.draft_reference ?? "";
  const canEmail = doc != null && doc.status !== "draft" && doc.status !== "voided";

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 32 }}
    >
      {error ? (
        <Text selectable style={{ color: colors.destructive }}>
          {error}
        </Text>
      ) : null}
      {doc ? (
        <>
          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <Text selectable style={{ color: colors.label, fontSize: 24, fontWeight: "800", fontVariant: ["tabular-nums"] }}>
                {number}
              </Text>
              <StatusPill status={doc.status} />
            </View>
            <Text style={{ color: colors.secondaryLabel, fontSize: 14 }}>
              {docTypeLabel(doc.document_type, t)}
              {name ? ` · ${name}` : ""}
            </Text>
            <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>
              {doc.invoice_date}
              {doc.due_date ? ` · ${t.dueBy}: ${doc.due_date}` : ""}
            </Text>
            {doc.allocation_number ? (
              <Text selectable style={{ color: colors.secondaryLabel, fontSize: 13 }}>
                {t.allocationNumber}: {doc.allocation_number}
              </Text>
            ) : null}
          </View>

          <SectionCard title={t.lines}>
            {doc.items.map((item, index) => (
              <View
                key={index}
                style={{
                  flexDirection: "row",
                  gap: 12,
                  paddingTop: index === 0 ? 0 : 10,
                  borderTopWidth: index === 0 ? 0 : 1,
                  borderTopColor: colors.separator,
                }}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: colors.label, fontSize: 15, fontWeight: "600" }}>{item.description}</Text>
                  <Text style={{ color: colors.secondaryLabel, fontSize: 13, fontVariant: ["tabular-nums"] }}>
                    {item.quantity} × {money(item.unitPrice)}
                  </Text>
                </View>
                <Text selectable style={{ color: colors.label, fontWeight: "700", fontVariant: ["tabular-nums"] }}>
                  {money(item.total)}
                </Text>
              </View>
            ))}
          </SectionCard>

          <SectionCard title={t.total}>
            <TotalRow label={t.subtotal} value={money(doc.subtotal)} />
            <TotalRow label={`${t.vat} (${doc.vat_rate ?? 0}%)`} value={money(doc.vat_amount ?? 0)} />
            <TotalRow label={t.total} value={money(doc.total)} bold />
          </SectionCard>

          {doc.notes ? (
            <SectionCard title={t.notesTitle}>
              <Text selectable style={{ color: colors.label, fontSize: 14, lineHeight: 20 }}>
                {doc.notes}
              </Text>
            </SectionCard>
          ) : null}

          {pdfUrl ? <InvoicePreview url={pdfUrl} failedLabel={t.previewFailed} /> : null}
          {pdfUrl ? (
            <ActionButton label={sharing ? t.loading : t.share} disabled={sharing} onPress={() => void share()} />
          ) : null}
          {canEmail ? (
            <SendEmailCard invoiceId={doc.id} number={doc.formatted_number ?? ""} defaultRecipient={customerEmail} />
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

function TotalRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  const colors = usePalette();
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <Text
        style={{
          flex: 1,
          color: bold ? colors.label : colors.secondaryLabel,
          fontSize: bold ? 17 : 14,
          fontWeight: bold ? "800" : "600",
        }}
      >
        {label}
      </Text>
      <Text
        selectable
        style={{
          color: colors.label,
          fontSize: bold ? 20 : 15,
          fontWeight: bold ? "800" : "600",
          fontVariant: ["tabular-nums"],
        }}
      >
        {value}
      </Text>
    </View>
  );
}
