"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Save } from "lucide-react";
import {
  addVendorAlias,
  createVendor,
  findVendorByNameOrAlias,
} from "@/features/expenses/actions/vendor-actions";
import { updateInvoice } from "@/features/expenses/actions/invoice-actions";
import { useT } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";
import { formatRich } from "@/lib/i18n/rich";

export interface VendorResolutionResult {
  vendorId: string;
  vendorName: string;
}

interface VendorResolutionPanelProps {
  invoiceId: string;
  /** AI-extracted name when no vendor matched. Triggers "resolve" mode (red). */
  suggestedVendorName?: string | null;
  /** Already-linked vendor; triggers "override" mode (neutral) so the user
   *  can swap to a different existing vendor or create a new one even though
   *  extraction already matched something. */
  currentVendor?: { id: string; name: string } | null;
  vendors: { id: string; name: string; isIncomeSource: boolean }[];
  onResolved: (result: VendorResolutionResult) => void;
}

export function VendorResolutionPanel({
  invoiceId,
  suggestedVendorName,
  currentVendor,
  vendors,
  onResolved,
}: VendorResolutionPanelProps) {
  const t = useT().invoices.vendorResolution;
  // Override mode flips the panel from a required-resolution warning into a
  // neutral "change the auto-detected vendor" control. The action handlers
  // are identical — both end up calling updateInvoice with a vendorId and
  // clearing suggestedVendorName.
  const isOverride = !!currentVendor;
  const [draft, setDraft] = useState(suggestedVendorName ?? "");
  const [existingId, setExistingId] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    setDraft(suggestedVendorName ?? "");
    setExistingId("");
  }, [invoiceId, suggestedVendorName, currentVendor?.id]);

  async function saveNew() {
    // Save whatever the user currently has in the "Vendor name" input —
    // edits included. We pass the name explicitly to updateInvoice so the
    // server doesn't treat any stale form value as authoritative.
    const name = draft.trim();
    if (!name) {
      setMsg({ type: "error", text: t.enterVendorName });
      return;
    }
    setLoading(true);
    setMsg(null);
    try {
      // Reuse an existing vendor when the typed name matches its name OR
      // any of its aliases (case-insensitive). Avoids duplicates after merges.
      const existing = await findVendorByNameOrAlias(name);
      const vendorId = existing?.id ?? (await createVendor({ name })).id;
      const resolvedName = existing?.name ?? name;
      const result = await updateInvoice(invoiceId, {
        vendorId,
        suggestedVendorName: null,
      });
      // Surface server-side validation messages; Next.js production
      // redacts thrown server-action errors but preserves returns.
      if (!result.success) throw new Error(result.error);
      setMsg({
        type: "success",
        text: existing
          ? format(t.linkedToExisting, { name: existing.name })
          : t.vendorSaved,
      });
      onResolved({ vendorId, vendorName: resolvedName });
    } catch (e) {
      setMsg({
        type: "error",
        text: e instanceof Error ? e.message : t.couldNotAdd,
      });
    } finally {
      setLoading(false);
    }
  }

  async function useExisting() {
    if (!existingId) {
      setMsg({ type: "error", text: t.selectExisting });
      return;
    }
    if (isOverride && existingId === currentVendor?.id) {
      setMsg({
        type: "error",
        text: t.alreadyLinked,
      });
      return;
    }
    const selected = vendors.find((v) => v.id === existingId);
    if (!selected) {
      setMsg({ type: "error", text: t.selectExisting });
      return;
    }
    setLoading(true);
    setMsg(null);
    try {
      // Remember the text currently in the input as an alias on the chosen
      // vendor so the next time extraction produces the same label it auto-
      // resolves. Skips duplicates and the vendor's primary name server-side.
      const aliasCandidate = draft.trim();
      if (aliasCandidate) {
        try {
          await addVendorAlias(existingId, aliasCandidate);
        } catch {
          // Non-fatal: linking the invoice is more important than remembering
          // the alias. Swallow so the user still gets their vendor linked.
        }
      }
      const result = await updateInvoice(invoiceId, {
        vendorId: existingId,
        suggestedVendorName: null,
      });
      if (!result.success) throw new Error(result.error);
      setMsg({ type: "success", text: t.vendorLinked });
      onResolved({ vendorId: existingId, vendorName: selected.name });
    } catch (e) {
      setMsg({
        type: "error",
        text: e instanceof Error ? e.message : t.couldNotLink,
      });
    } finally {
      setLoading(false);
    }
  }

  // Visual treatment differs by mode: red for "must resolve", blue for the
  // optional override on an already-matched invoice.
  const styles = isOverride
    ? {
        wrap: "space-y-3 rounded-md border border-blue-200 bg-blue-50 p-3",
        text: "text-sm text-blue-800",
        label: "text-blue-800",
        input:
          "border-blue-300 bg-white text-blue-900 placeholder:text-blue-400",
        button: "border-blue-300 text-blue-900 hover:bg-blue-100",
        divider: "flex flex-wrap items-end gap-2 border-t border-blue-200 pt-3",
        trigger: "border-blue-300 bg-white",
      }
    : {
        wrap: "space-y-3 rounded-md border border-red-200 bg-red-50 p-3",
        text: "text-sm text-red-800",
        label: "text-red-800",
        input:
          "border-red-300 bg-white text-red-900 placeholder:text-red-400",
        button: "border-red-300 text-red-900 hover:bg-red-100",
        divider: "flex flex-wrap items-end gap-2 border-t border-red-200 pt-3",
        trigger: "border-red-300 bg-white",
      };

  return (
    <div className={styles.wrap}>
      {isOverride && currentVendor ? (
        <p className={styles.text}>
          {formatRich(t.overrideHint, {
            vendor: <strong>{currentVendor.name}</strong>,
            saveVendor: <strong>{t.saveVendor}</strong>,
            useSelected: <strong>{t.useSelected}</strong>,
          })}
        </p>
      ) : (
        <p className={styles.text}>
          {formatRich(t.resolveHint, {
            saveVendor: <strong>{t.saveVendor}</strong>,
          })}
        </p>
      )}
      {msg && (
        <p
          className={
            msg.type === "success"
              ? "text-sm text-green-800"
              : "text-sm text-red-800"
          }
        >
          {msg.text}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[200px] flex-1 space-y-1">
          <Label className={styles.label}>{t.vendorName}</Label>
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className={styles.input}
            placeholder={t.namePlaceholder}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={styles.button}
          disabled={loading}
          onClick={saveNew}
        >
          {loading ? (
            <Loader2 className="me-1 h-4 w-4 animate-spin" />
          ) : (
            <Save className="me-1 h-4 w-4" />
          )}
          {t.saveVendor}
        </Button>
      </div>
      {vendors.length > 0 && (
        <div className={styles.divider}>
          <div className="min-w-[200px] flex-1 space-y-1">
            <Label className={styles.label}>
              {isOverride ? t.orUseDifferent : t.orUseExisting}
            </Label>
            <Select
              value={existingId || undefined}
              onValueChange={setExistingId}
            >
              <SelectTrigger className={styles.trigger}>
                <SelectValue placeholder={t.selectPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                {vendors.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={loading}
            onClick={useExisting}
          >
            {t.useSelected}
          </Button>
        </div>
      )}
    </div>
  );
}
