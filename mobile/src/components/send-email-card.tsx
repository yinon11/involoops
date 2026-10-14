import { useState } from "react";
import { Text, View } from "react-native";
import { strings } from "@/constants/copy";
import { useSession } from "@/hooks/use-session";
import { ApiProblem, apiJson, idempotencyKey } from "@/utils/api";
import { ActionButton } from "@/components/action-button";
import { TextField } from "@/components/text-field";
import { SectionCard } from "@/components/section-card";
import { usePalette } from "@/theme";

/**
 * "Send by email" card for an issued document. Handles the SHAAM gate:
 * a 409 from the send reveals the queue-for-clear / force options, same
 * as the browser's send dialog.
 */
export function SendEmailCard({
  invoiceId,
  number,
  defaultRecipient,
}: {
  invoiceId: string;
  number: string;
  defaultRecipient: string;
}) {
  const { session } = useSession();
  const t = strings(session?.user.locale ?? "en");
  const colors = usePalette();
  const [recipient, setRecipient] = useState(defaultRecipient);
  const [sendPending, setSendPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [queued, setQueued] = useState(false);
  const [shaamGated, setShaamGated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendEmail(mode: "normal" | "force" | "queue" = "normal") {
    if (sendPending) return;
    setSendPending(true);
    setError(null);
    try {
      const subject = number ? `${t.emailSubjectPrefix} ${number}` : t.emailSubjectPrefix;
      await apiJson(`/api/v1/outbound-invoices/${invoiceId}/send`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey() },
        body: JSON.stringify({
          to: recipient.trim(),
          subject,
          body: t.emailBody,
          ...(mode === "force" ? { force: true } : {}),
          ...(mode === "queue" ? { queue_for_clear: true } : {}),
        }),
      });
      if (mode === "queue") {
        setQueued(true);
      } else {
        setSent(true);
      }
      setShaamGated(false);
    } catch (err) {
      // 409 means the SHAAM gate blocked the send — same as the browser's
      // send modal, offer queue-for-clear or an explicit force send.
      if (mode === "normal" && err instanceof ApiProblem && err.status === 409) {
        setShaamGated(true);
      } else {
        setError(err instanceof ApiProblem ? err.message : t.error);
      }
    } finally {
      setSendPending(false);
    }
  }

  return (
    <SectionCard title={t.sendByEmail}>
      <TextField
        label={t.recipientEmail}
        value={recipient}
        onChangeText={setRecipient}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      {error ? (
        <Text selectable style={{ color: colors.destructive }}>
          {error}
        </Text>
      ) : null}
      {sent ? (
        <Text style={{ color: colors.income, fontWeight: "700" }}>{t.emailSent} ✓</Text>
      ) : queued ? (
        <Text style={{ color: colors.income, fontWeight: "700" }}>{t.queuedOk} ✓</Text>
      ) : shaamGated ? (
        <View
          style={{
            backgroundColor: colors.warningSoft,
            borderRadius: 14,
            borderCurve: "continuous",
            padding: 14,
            gap: 10,
          }}
        >
          <Text style={{ color: colors.warning, fontSize: 15, fontWeight: "700" }}>{t.shaamGateTitle}</Text>
          <Text style={{ color: colors.warning, fontSize: 13, lineHeight: 19 }}>{t.shaamGateBody}</Text>
          <ActionButton
            label={sendPending ? t.loading : t.queueSend}
            disabled={sendPending}
            onPress={() => void sendEmail("queue")}
          />
          <ActionButton
            variant="secondary"
            label={sendPending ? t.loading : t.sendAnyway}
            disabled={sendPending}
            onPress={() => void sendEmail("force")}
          />
        </View>
      ) : (
        <ActionButton
          variant="secondary"
          label={sendPending ? t.loading : t.sendByEmail}
          disabled={sendPending || !recipient.trim()}
          onPress={() => void sendEmail()}
        />
      )}
    </SectionCard>
  );
}
