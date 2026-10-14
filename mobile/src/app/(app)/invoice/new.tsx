import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, Switch, Text, View } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { strings } from "@/constants/copy";
import { useSession } from "@/hooks/use-session";
import { ApiProblem, apiJson, idempotencyKey } from "@/utils/api";
import { formatMoney } from "@/utils/format";
import { ActionButton } from "@/components/action-button";
import { TextField } from "@/components/text-field";
import { Dropdown } from "@/components/dropdown";
import { SectionCard } from "@/components/section-card";
import { SendEmailCard } from "@/components/send-email-card";
import { brand, usePalette } from "@/theme";
import { cashCeilingExceeded } from "@/documents/cash-ceiling";

const MAX_LINES = 50;
const MAX_DESCRIPTION = 500;
const MAX_NOTES = 4000;

interface Customer {
  id: string;
  name: string;
  email: string | null;
  tax_id?: string | null;
}

interface BusinessEntity {
  default_vat_inclusive: boolean;
}

interface IssuedInvoice {
  id: string;
  formatted_number: string | null;
}

interface RcStatus {
  reverse_charge: boolean;
  seller_acknowledgement: string;
  consent: {
    state: "pending" | "signed" | "expired" | "revoked" | "stale";
    recipient_email: string;
    expires_at: string;
    signed_at: string | null;
    signer_name: string | null;
  } | null;
}

type DocType = "TAX_INVOICE" | "TAX_INVOICE_RECEIPT" | "RECEIPT" | "PROFORMA" | "DELIVERY_NOTE";
type PayMethod = "cash" | "check" | "card" | "bank_transfer" | "other";

interface Line {
  key: number;
  description: string;
  quantity: string;
  unitPrice: string;
}

const NEW_CUSTOMER = "__new__";
const STATUTORY_VAT = 18;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayInIsrael(): string {
  // en-CA renders YYYY-MM-DD; Israel civil day, not UTC.
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function toNumber(value: string): number {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export default function NewInvoiceScreen() {
  const { session } = useSession();
  const locale = session?.user.locale ?? "en";
  const t = strings(locale);
  const colors = usePalette();

  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [documentType, setDocumentType] = useState<DocType>("TAX_INVOICE");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newTaxId, setNewTaxId] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [lines, setLines] = useState<Line[]>([{ key: 1, description: "", quantity: "1", unitPrice: "" }]);
  const [invoiceDate, setInvoiceDate] = useState(todayInIsrael());
  const [dueDate, setDueDate] = useState("");
  const [currency, setCurrency] = useState("ILS");
  const [language, setLanguage] = useState(locale);
  const [chargeVat, setChargeVat] = useState(true);
  const [notes, setNotes] = useState("");
  const [payMethod, setPayMethod] = useState<PayMethod>("bank_transfer");
  const [payReference, setPayReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [issued, setIssued] = useState<{
    id: string;
    number: string;
    pdfPath: string;
    email: string;
  } | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [rejection, setRejection] = useState<{ message: string; options: string[] } | null>(null);
  const [decisionDone, setDecisionDone] = useState<"hearing" | "cancel" | null>(null);
  const [rc, setRc] = useState<RcStatus | null>(null);
  const [rcAcked, setRcAcked] = useState(false);
  const [rcEmail, setRcEmail] = useState("");
  const [rcLink, setRcLink] = useState<string | null>(null);
  const [rcEmailSent, setRcEmailSent] = useState<boolean | null>(null);
  const [rcBusy, setRcBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiJson<{ data: Customer[] }>("/api/v1/customers?limit=50")
      .then((page) => {
        if (!cancelled) setCustomers(page.data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiProblem ? err.message : t.error);
      });
    // The entity's default decides whether fresh drafts charge VAT (Osek Patur does not).
    apiJson<BusinessEntity>("/api/v1/business-entity")
      .then((entity) => {
        if (!cancelled) setChargeVat(entity.default_vat_inclusive);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [t.error]);

  const paymentsRequired = documentType === "RECEIPT" || documentType === "TAX_INVOICE_RECEIPT";
  // A pure receipt settles a tax invoice that already charged VAT.
  const vatLocked = documentType === "RECEIPT";
  const vatRate = vatLocked ? 0 : chargeVat ? STATUTORY_VAT : 0;

  const totals = useMemo(() => {
    const lineTotals = lines.map((line) => round2(toNumber(line.quantity) * toNumber(line.unitPrice)));
    const subtotal = round2(lineTotals.reduce((sum, value) => sum + value, 0));
    const vat = round2((subtotal * vatRate) / 100);
    return { lineTotals, subtotal, vat, total: round2(subtotal + vat) };
  }, [lines, vatRate]);

  const money = (amount: number) => formatMoney(amount, currency, locale);
  const selectedCustomer = customers?.find((customer) => customer.id === customerId) ?? null;
  const payable = rc ? totals.subtotal : totals.total;
  const cashOverCeiling =
    paymentsRequired &&
    payMethod === "cash" &&
    cashCeilingExceeded({
      amount: payable,
      currency,
      customerTaxId: customerId === NEW_CUSTOMER ? newTaxId : selectedCustomer?.tax_id,
    });

  function updateLine(key: number, patch: Partial<Line>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  async function issue() {
    if (pending) return;
    setPending(true);
    setError(null);
    setRejection(null);
    setDecisionDone(null);
    try {
      if (!DATE_RE.test(invoiceDate) || (dueDate.trim() && !DATE_RE.test(dueDate.trim()))) {
        throw new ApiProblem(t.badDate, 422);
      }
      const validLines = lines.filter(
        (line) =>
          line.description.trim() &&
          toNumber(line.quantity) > 0 &&
          Number.isFinite(toNumber(line.unitPrice)),
      );
      if (validLines.length === 0) throw new ApiProblem(t.needLine, 422);
      if (totals.total <= 0) throw new ApiProblem(t.totalPositive, 422);

      let id = customerId;
      let customerEmail = selectedCustomer?.email ?? "";
      if (!id || id === NEW_CUSTOMER) {
        const name = newName.trim();
        if (!name) throw new ApiProblem(t.newCustomer, 422);
        const created = await apiJson<Customer>("/api/v1/customers", {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": idempotencyKey() },
          body: JSON.stringify({
            name,
            tax_id: newTaxId.trim() || null,
            email: newEmail.trim() || null,
          }),
        });
        id = created.id;
        customerEmail = newEmail.trim();
      }

      const draft = await apiJson<{ id: string }>("/api/v1/outbound-invoices", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey() },
        body: JSON.stringify({
          document_type: documentType,
          customer_id: id,
          invoice_date: invoiceDate,
          due_date: dueDate.trim() || null,
          language,
          currency,
          items: validLines.map((line) => {
            const quantity = toNumber(line.quantity);
            const unitPrice = toNumber(line.unitPrice);
            return {
              description: line.description.trim(),
              quantity,
              unitPrice,
              total: round2(quantity * unitPrice),
            };
          }),
          subtotal: totals.subtotal.toFixed(2),
          vat_rate: String(vatRate),
          vat_amount: totals.vat.toFixed(2),
          total: totals.total.toFixed(2),
          notes: notes.trim() || null,
          ...(paymentsRequired
            ? {
                payments: [
                  {
                    method: payMethod,
                    amount: totals.total,
                    currency,
                    date: invoiceDate,
                    ...(payReference.trim() ? { reference: payReference.trim() } : {}),
                  },
                ],
              }
            : {}),
        }),
      });

      setDraftId(draft.id);
      await finishIssue(draft.id, customerEmail ?? "");
    } catch (err) {
      handleIssueError(err);
    } finally {
      setPending(false);
    }
  }

  /** Issue the draft (optionally without allocation), then fetch the PDF. */
  async function finishIssue(
    id: string,
    customerEmail: string,
    onRejection?: "issue_without_allocation",
  ) {
    let result: IssuedInvoice;
    try {
      result = await apiJson<IssuedInvoice>(`/api/v1/outbound-invoices/${id}/issue`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey() },
        body: JSON.stringify({
          // The visible 0% toggle is the user's confirmation.
          ...(vatRate === 0 ? { confirm_zero_vat: true } : {}),
          ...(onRejection ? { on_rejection: onRejection } : {}),
        }),
      });
    } catch (err) {
      if (err instanceof ApiProblem && err.code === "ita_approval_required") {
        throw new ApiProblem(t.issuingPaused, err.status, err.code);
      }
      throw err;
    }

    const link = await apiJson<{ url: string }>(`/api/v1/outbound-invoices/${id}/pdf`);
    const file = await File.downloadFileAsync(link.url, new File(Paths.cache, `${id}.pdf`), {
      idempotent: true,
    });
    setRejection(null);
    setIssued({ id, number: result.formatted_number ?? "", pdfPath: file.uri, email: customerEmail });
  }

  function handleIssueError(err: unknown) {
    // SHAAM refused the allocation: surface the statutory options (same
    // choice the browser's rejection dialog presents) instead of a dead end.
    if (err instanceof ApiProblem && (err.code === "shaam_rejected" || err.code === "shaam_held")) {
      const options = Array.isArray(err.meta?.options)
        ? (err.meta.options as string[])
        : ["issue_without_allocation", "hearing", "reverse_charge", "cancel"];
      setRejection({ message: err.message, options });
      return;
    }
    setError(err instanceof ApiProblem ? err.message : err instanceof Error ? err.message : t.error);
  }

  async function issueWithoutAllocation() {
    if (!draftId || pending) return;
    setPending(true);
    setError(null);
    try {
      await finishIssue(draftId, selectedCustomer?.email ?? newEmail.trim(), "issue_without_allocation");
    } catch (err) {
      handleIssueError(err);
    } finally {
      setPending(false);
    }
  }

  async function shaamDecision(decision: "hearing" | "cancel") {
    if (!draftId || pending) return;
    setPending(true);
    setError(null);
    try {
      await apiJson(`/api/v1/outbound-invoices/${draftId}/shaam-decision`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey() },
        body: JSON.stringify({ decision }),
      });
      setDecisionDone(decision);
      if (decision === "cancel") setDraftId(null);
    } catch (err) {
      setError(err instanceof ApiProblem ? err.message : t.error);
    } finally {
      setPending(false);
    }
  }

  async function startReverseCharge() {
    if (!draftId || rcBusy) return;
    setRcBusy(true);
    setError(null);
    try {
      const status = await apiJson<RcStatus>(`/api/v1/outbound-invoices/${draftId}/reverse-charge`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey() },
        body: JSON.stringify({ action: "enable" }),
      });
      setRc(status);
      setRcEmail(selectedCustomer?.email ?? newEmail.trim());
      setRejection(null);
    } catch (err) {
      setError(err instanceof ApiProblem ? err.message : t.error);
    } finally {
      setRcBusy(false);
    }
  }

  async function refreshRc() {
    if (!draftId || rcBusy) return;
    setRcBusy(true);
    setError(null);
    try {
      setRc(await apiJson<RcStatus>(`/api/v1/outbound-invoices/${draftId}/reverse-charge`));
    } catch (err) {
      setError(err instanceof ApiProblem ? err.message : t.error);
    } finally {
      setRcBusy(false);
    }
  }

  async function requestRcConsent() {
    if (!draftId || rcBusy) return;
    setRcBusy(true);
    setError(null);
    try {
      const result = await apiJson<{ link: string; email_sent: boolean; recipient_email: string }>(
        `/api/v1/outbound-invoices/${draftId}/reverse-charge/consent`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": idempotencyKey() },
          body: JSON.stringify({
            seller_acknowledged: true,
            recipient_email: rcEmail.trim() || undefined,
          }),
        },
      );
      setRcLink(result.link);
      setRcEmailSent(result.email_sent);
      setRcEmail(result.recipient_email);
      setRc(await apiJson<RcStatus>(`/api/v1/outbound-invoices/${draftId}/reverse-charge`));
    } catch (err) {
      setError(err instanceof ApiProblem ? err.message : t.error);
    } finally {
      setRcBusy(false);
    }
  }

  async function removeRc() {
    if (!draftId || rcBusy) return;
    setRcBusy(true);
    setError(null);
    try {
      await apiJson(`/api/v1/outbound-invoices/${draftId}/reverse-charge`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey() },
        body: JSON.stringify({ action: "disable" }),
      });
      setRc(null);
      setRcLink(null);
      setRcEmailSent(null);
      setRcAcked(false);
    } catch (err) {
      setError(err instanceof ApiProblem ? err.message : t.error);
    } finally {
      setRcBusy(false);
    }
  }

  async function issueReverseCharge() {
    if (!draftId || pending) return;
    setPending(true);
    setError(null);
    try {
      await finishIssue(draftId, rcEmail.trim());
    } catch (err) {
      handleIssueError(err);
    } finally {
      setPending(false);
    }
  }

  function rcStateText(state: NonNullable<RcStatus["consent"]>["state"]): string {
    switch (state) {
      case "pending":
        return t.rcPendingSig;
      case "signed":
        return t.rcSigned;
      case "expired":
        return t.rcExpired;
      case "revoked":
        return t.rcRevoked;
      case "stale":
        return t.rcStale;
    }
  }

  async function share() {
    if (!issued) return;
    await Sharing.shareAsync(issued.pdfPath, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
  }

  if (customers === null && !error) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={brand.violet} />
      </View>
    );
  }

  if (issued) {
    return (
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 32 }}
      >
        <View
          style={{
            backgroundColor: colors.incomeSoft,
            borderRadius: 20,
            borderCurve: "continuous",
            padding: 20,
            gap: 6,
            alignItems: "center",
          }}
        >
          <Text style={{ fontSize: 34 }}>✓</Text>
          <Text style={{ color: colors.income, fontSize: 18, fontWeight: "800" }}>{t.issued}</Text>
          {issued.number ? (
            <Text selectable style={{ color: colors.income, fontSize: 15, fontWeight: "600", fontVariant: ["tabular-nums"] }}>
              {issued.number}
            </Text>
          ) : null}
          <Text selectable style={{ color: colors.income, fontSize: 15, fontWeight: "600", fontVariant: ["tabular-nums"] }}>
            {money(totals.total)}
          </Text>
        </View>
        <ActionButton label={t.share} onPress={() => void share()} />
        <SendEmailCard invoiceId={issued.id} number={issued.number} defaultRecipient={issued.email} />
      </ScrollView>
    );
  }

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }}
    >
      <SectionCard title={t.docType}>
        <Dropdown<DocType>
          sheetTitle={t.docType}
          value={documentType}
          onChange={setDocumentType}
          options={[
            { value: "TAX_INVOICE", label: t.docTaxInvoice },
            { value: "TAX_INVOICE_RECEIPT", label: t.docTaxInvoiceReceipt },
            { value: "RECEIPT", label: t.docReceipt },
            { value: "PROFORMA", label: t.docProforma },
            { value: "DELIVERY_NOTE", label: t.docDeliveryNote },
          ]}
        />
      </SectionCard>

      <SectionCard title={t.customer}>
        <Dropdown<string>
          sheetTitle={t.customer}
          placeholder={t.choose}
          searchPlaceholder={t.search}
          value={customerId}
          onChange={setCustomerId}
          options={[
            ...(customers ?? []).map((customer) => ({
              value: customer.id,
              label: customer.name,
              hint: customer.email ?? undefined,
            })),
            { value: NEW_CUSTOMER, label: `＋ ${t.newCustomer}` },
          ]}
        />
        {customerId === NEW_CUSTOMER ? (
          <View style={{ gap: 12 }}>
            <TextField label={t.newCustomer} value={newName} onChangeText={setNewName} />
            <TextField label={t.taxId} value={newTaxId} onChangeText={setNewTaxId} keyboardType="number-pad" />
            <TextField
              label={t.email}
              value={newEmail}
              onChangeText={setNewEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
          </View>
        ) : null}
      </SectionCard>

      <SectionCard title={t.lines}>
        {lines.map((line, index) => (
          <View
            key={line.key}
            style={{
              gap: 10,
              paddingTop: index === 0 ? 0 : 12,
              borderTopWidth: index === 0 ? 0 : 1,
              borderTopColor: colors.separator,
            }}
          >
            <TextField
              label={t.description}
              value={line.description}
              maxLength={MAX_DESCRIPTION}
              onChangeText={(value) => updateLine(line.key, { description: value.slice(0, MAX_DESCRIPTION) })}
            />
            <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-end" }}>
              <View style={{ flex: 1 }}>
                <TextField
                  label={t.quantity}
                  value={line.quantity}
                  onChangeText={(value) => updateLine(line.key, { quantity: value })}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={{ flex: 2 }}>
                <TextField
                  label={t.unitPrice}
                  value={line.unitPrice}
                  onChangeText={(value) => updateLine(line.key, { unitPrice: value })}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text
                selectable
                style={{ flex: 1, color: colors.secondaryLabel, fontWeight: "600", fontVariant: ["tabular-nums"] }}
              >
                {money(totals.lineTotals[index] ?? 0)}
              </Text>
              {lines.length > 1 ? (
                <Pressable
                  hitSlop={8}
                  onPress={() => setLines((current) => current.filter((item) => item.key !== line.key))}
                >
                  <Text style={{ color: colors.destructive, fontSize: 13, fontWeight: "600" }}>{t.remove}</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ))}
        <ActionButton
          variant="secondary"
          label={`＋ ${t.addLine}`}
          disabled={lines.length >= MAX_LINES}
          onPress={() =>
            setLines((current) =>
              current.length >= MAX_LINES
                ? current
                : [
                    ...current,
                    { key: Math.max(...current.map((line) => line.key)) + 1, description: "", quantity: "1", unitPrice: "" },
                  ],
            )
          }
        />
        {lines.length >= MAX_LINES ? (
          <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>{t.lineLimit}</Text>
        ) : null}
      </SectionCard>

      <SectionCard title={t.date}>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <TextField label={t.date} value={invoiceDate} onChangeText={setInvoiceDate} placeholder={t.datePlaceholder} />
          </View>
          <View style={{ flex: 1 }}>
            <TextField label={t.dueDate} value={dueDate} onChangeText={setDueDate} placeholder={t.datePlaceholder} />
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Dropdown<string>
              label={t.currency}
              value={currency}
              onChange={setCurrency}
              options={["ILS", "USD", "EUR", "GBP"].map((code) => ({ value: code, label: code }))}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Dropdown<"en" | "he">
              label={t.language}
              value={language}
              onChange={setLanguage}
              options={[
                { value: "he", label: "עברית" },
                { value: "en", label: "English" },
              ]}
            />
          </View>
        </View>
        {vatLocked ? (
          <Text style={{ color: colors.secondaryLabel, fontSize: 13, lineHeight: 18 }}>{t.receiptNoVat}</Text>
        ) : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Text style={{ flex: 1, color: colors.label, fontSize: 15, fontWeight: "600" }}>{t.chargeVat}</Text>
            <Switch
              value={chargeVat}
              onValueChange={setChargeVat}
              trackColor={{ true: brand.violet }}
              thumbColor="#FFFFFF"
            />
          </View>
        )}
        <TextField
          label={t.notes}
          value={notes}
          maxLength={MAX_NOTES}
          onChangeText={(value) => setNotes(value.slice(0, MAX_NOTES))}
          multiline
          numberOfLines={3}
        />
      </SectionCard>

      {paymentsRequired ? (
        <SectionCard title={t.paymentMethod}>
          <Dropdown<PayMethod>
            sheetTitle={t.paymentMethod}
            value={payMethod}
            onChange={setPayMethod}
            options={[
              { value: "bank_transfer", label: t.payBankTransfer },
              { value: "card", label: t.payCard },
              { value: "cash", label: t.payCash },
              { value: "check", label: t.payCheck },
              { value: "other", label: t.payOther },
            ]}
          />
          <TextField label={t.paymentReference} value={payReference} onChangeText={setPayReference} />
          <Text style={{ color: colors.secondaryLabel, fontSize: 13, lineHeight: 18 }}>{t.paymentAutoHint}</Text>
          {cashOverCeiling ? (
            <View
              style={{
                backgroundColor: colors.warningSoft,
                borderRadius: 12,
                borderCurve: "continuous",
                padding: 12,
              }}
            >
              <Text style={{ color: colors.warning, fontSize: 14, fontWeight: "800", lineHeight: 20 }}>
                {t.cashCeilingWarning}
              </Text>
            </View>
          ) : null}
        </SectionCard>
      ) : null}

      <SectionCard title={t.total}>
        <TotalRow label={t.subtotal} value={money(totals.subtotal)} />
        <TotalRow
          label={`${t.vat} (${rc ? 0 : vatRate}%)`}
          value={money(rc ? 0 : totals.vat)}
        />
        <TotalRow label={t.total} value={money(rc ? totals.subtotal : totals.total)} bold />
      </SectionCard>

      {error ? (
        <Text selectable style={{ color: colors.destructive }}>
          {error}
        </Text>
      ) : null}
      {rejection ? (
        <View
          style={{
            backgroundColor: colors.warningSoft,
            borderRadius: 16,
            borderCurve: "continuous",
            padding: 16,
            gap: 10,
          }}
        >
          <Text style={{ color: colors.warning, fontSize: 15, fontWeight: "800" }}>
            {t.shaamRejectedTitle}
          </Text>
          <Text selectable style={{ color: colors.warning, fontSize: 13, lineHeight: 19 }}>
            {rejection.message}
          </Text>
          {decisionDone === "cancel" ? (
            <Text style={{ color: colors.label, fontWeight: "700" }}>{t.docCancelled} ✓</Text>
          ) : (
            <>
              {decisionDone === "hearing" ? (
                <Text style={{ color: colors.label, fontWeight: "600" }}>{t.hearingRequested} ✓</Text>
              ) : null}
              {rejection.options.includes("issue_without_allocation") ? (
                <ActionButton
                  label={pending ? t.loading : t.optIssueWithout}
                  disabled={pending}
                  onPress={() => void issueWithoutAllocation()}
                />
              ) : null}
              {rejection.options.includes("hearing") && decisionDone !== "hearing" ? (
                <ActionButton
                  variant="secondary"
                  label={pending ? t.loading : t.optHearing}
                  disabled={pending}
                  onPress={() => void shaamDecision("hearing")}
                />
              ) : null}
              {rejection.options.includes("cancel") ? (
                <ActionButton
                  variant="danger"
                  label={pending ? t.loading : t.optCancel}
                  disabled={pending}
                  onPress={() => void shaamDecision("cancel")}
                />
              ) : null}
              {rejection.options.includes("reverse_charge") ? (
                <ActionButton
                  variant="secondary"
                  label={rcBusy ? t.loading : t.rcTitle}
                  disabled={pending || rcBusy}
                  onPress={() => void startReverseCharge()}
                />
              ) : null}
            </>
          )}
        </View>
      ) : null}
      {rc ? (
        <SectionCard title={t.rcTitle}>
          <Text style={{ color: colors.secondaryLabel, fontSize: 13, lineHeight: 19 }}>{t.rcExplain}</Text>
          {rc.consent ? (
            <View
              style={{
                backgroundColor: rc.consent.state === "signed" ? colors.incomeSoft : colors.warningSoft,
                borderRadius: 12,
                borderCurve: "continuous",
                padding: 12,
                gap: 2,
              }}
            >
              <Text
                style={{
                  color: rc.consent.state === "signed" ? colors.income : colors.warning,
                  fontSize: 14,
                  fontWeight: "700",
                }}
              >
                {rcStateText(rc.consent.state)}
              </Text>
              <Text
                selectable
                style={{
                  color: rc.consent.state === "signed" ? colors.income : colors.warning,
                  fontSize: 12,
                }}
              >
                {rc.consent.recipient_email}
                {rc.consent.signer_name ? ` · ${rc.consent.signer_name}` : ""}
              </Text>
            </View>
          ) : null}
          {rc.consent?.state === "signed" ? (
            <ActionButton
              label={pending ? t.loading : t.issue}
              disabled={pending}
              onPress={() => void issueReverseCharge()}
            />
          ) : (
            <>
              <View
                style={{
                  backgroundColor: colors.background,
                  borderWidth: 1,
                  borderColor: colors.separator,
                  borderRadius: 12,
                  borderCurve: "continuous",
                  padding: 12,
                }}
              >
                <Text selectable style={{ color: colors.secondaryLabel, fontSize: 12, lineHeight: 18 }}>
                  {rc.seller_acknowledgement}
                </Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <Text style={{ flex: 1, color: colors.label, fontSize: 15, fontWeight: "600" }}>
                  {t.rcAckLabel}
                </Text>
                <Switch
                  value={rcAcked}
                  onValueChange={setRcAcked}
                  trackColor={{ true: brand.violet }}
                  thumbColor="#FFFFFF"
                />
              </View>
              <TextField
                label={t.recipientEmail}
                value={rcEmail}
                onChangeText={setRcEmail}
                autoCapitalize="none"
                keyboardType="email-address"
              />
              <ActionButton
                label={rcBusy ? t.loading : t.rcSendConsent}
                disabled={rcBusy || !rcAcked || !rcEmail.trim()}
                onPress={() => void requestRcConsent()}
              />
              {rcEmailSent !== null ? (
                <Text
                  style={{
                    color: rcEmailSent ? colors.income : colors.warning,
                    fontSize: 13,
                    fontWeight: "600",
                  }}
                >
                  {rcEmailSent ? `${t.rcEmailOk} ✓` : t.rcEmailFail}
                </Text>
              ) : null}
              {rcLink ? (
                <View style={{ gap: 6 }}>
                  <Text style={{ color: colors.secondaryLabel, fontSize: 13, fontWeight: "600" }}>
                    {t.rcLinkLabel}
                  </Text>
                  <Text selectable numberOfLines={2} style={{ color: colors.label, fontSize: 12 }}>
                    {rcLink}
                  </Text>
                  <ActionButton
                    variant="secondary"
                    label={t.rcShareLink}
                    onPress={() => {
                      void Share.share({ message: rcLink });
                    }}
                  />
                </View>
              ) : null}
              <ActionButton
                variant="secondary"
                label={rcBusy ? t.loading : t.rcCheckStatus}
                disabled={rcBusy}
                onPress={() => void refreshRc()}
              />
            </>
          )}
          <ActionButton
            variant="danger"
            label={rcBusy ? t.loading : t.rcRemove}
            disabled={rcBusy}
            onPress={() => void removeRc()}
          />
        </SectionCard>
      ) : (
        <ActionButton label={pending ? t.loading : t.issue} onPress={() => void issue()} disabled={pending} />
      )}
    </ScrollView>
  );
}

function TotalRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  const colors = usePalette();
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <Text style={{ flex: 1, color: bold ? colors.label : colors.secondaryLabel, fontSize: bold ? 17 : 14, fontWeight: bold ? "800" : "600" }}>
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
