"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { InvoiceTable } from "@/features/expenses/components/invoices/invoice-table";
import { RuleEditor } from "./rule-editor";
import { VendorExpenseChart } from "./vendor-expense-chart";
import { useT } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/format";
import { updateVendor } from "@/features/expenses/actions/vendor-actions";
import {
  ArrowLeft,
  Save,
  Loader2,
  Plus,
  X,
  Store,
} from "lucide-react";

interface VendorInfo {
  id: string;
  name: string;
  aliases: string[];
  defaultCategory: string | null;
  isIncomeSource: boolean | null;
  autoApprove: boolean | null;
}

interface ExtractionRule {
  id: string;
  vendorId: string | null;
  name: string | null;
  priority: number | null;
  rules: Record<string, unknown>;
  isActive: boolean | null;
}

interface InvoiceRow {
  id: string;
  invoiceDate: string;
  vendorName: string;
  vendorId?: string | null;
  suggestedVendorName?: string | null;
  amount: number;
  vatAmount: number | null;
  currency: string;
  invoiceNumber: string | null;
  fileUrl: string | null;
  addedMonth: string;
  status: string;
  sentToAccountantAt?: string | null;
}

interface Props {
  vendor: VendorInfo;
  extractionRules: ExtractionRule[];
  invoices: InvoiceRow[];
}

export function VendorDetailClient({
  vendor,
  extractionRules,
  invoices,
}: Props) {
  const router = useRouter();
  const dict = useT();
  const t = dict.vendors.detail;
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [, startTransition] = useTransition();
  const [togglingField, setTogglingField] = useState<
    "isIncomeSource" | "autoApprove" | null
  >(null);

  const [name, setName] = useState(vendor.name);
  const [aliases, setAliases] = useState<string[]>(vendor.aliases);
  const [newAlias, setNewAlias] = useState("");
  const [category, setCategory] = useState(vendor.defaultCategory ?? "");
  const [isIncomeSource, setIsIncomeSource] = useState(
    vendor.isIncomeSource ?? false
  );
  const [autoApprove, setAutoApprove] = useState(vendor.autoApprove ?? false);

  const [showNewRule, setShowNewRule] = useState(false);

  async function persistToggle(
    field: "isIncomeSource" | "autoApprove",
    value: boolean,
    revert: () => void
  ) {
    setTogglingField(field);
    setFeedback(null);
    try {
      await updateVendor(vendor.id, { [field]: value });
      startTransition(() => router.refresh());
    } catch (err) {
      revert();
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : t.updateFailed,
      });
    } finally {
      setTogglingField(null);
    }
  }

  function addAlias() {
    const trimmed = newAlias.trim();
    if (trimmed && !aliases.includes(trimmed)) {
      setAliases([...aliases, trimmed]);
      setNewAlias("");
    }
  }

  function removeAlias(alias: string) {
    setAliases(aliases.filter((a) => a !== alias));
  }

  async function handleSave() {
    setLoading(true);
    setFeedback(null);
    try {
      await updateVendor(vendor.id, {
        name,
        aliases,
        defaultCategory: category || undefined,
        isIncomeSource,
        autoApprove,
      });
      setFeedback({ type: "success", message: t.updated });
      router.refresh();
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : t.updateFailed,
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/vendors">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="me-1 h-4 w-4 rtl:rotate-180" />
            {t.back}
          </Button>
        </Link>
        <Store className="h-6 w-6 text-indigo-500" />
        <h1 className="text-2xl font-bold tracking-tight">{vendor.name}</h1>
        {vendor.isIncomeSource && (
          <Badge className="bg-green-100 text-green-800">{t.incomeBadge}</Badge>
        )}
        {vendor.autoApprove && (
          <Badge className="bg-blue-100 text-blue-800">{t.autoApproveBadge}</Badge>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Vendor Info Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t.vendorInformation}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t.name}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label>{t.category}</Label>
              <Input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder={t.categoryPlaceholder}
              />
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={isIncomeSource}
                disabled={togglingField === "isIncomeSource"}
                onCheckedChange={(next) => {
                  const prev = isIncomeSource;
                  setIsIncomeSource(next);
                  void persistToggle("isIncomeSource", next, () =>
                    setIsIncomeSource(prev)
                  );
                }}
              />
              <Label>{t.incomeSource}</Label>
              {togglingField === "isIncomeSource" && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              )}
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Switch
                  checked={autoApprove}
                  disabled={togglingField === "autoApprove"}
                  onCheckedChange={(next) => {
                    const prev = autoApprove;
                    setAutoApprove(next);
                    void persistToggle("autoApprove", next, () =>
                      setAutoApprove(prev)
                    );
                  }}
                />
                <Label>{t.autoApproveInvoices}</Label>
                {togglingField === "autoApprove" && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                )}
              </div>
              <p className="ps-11 text-xs text-muted-foreground">
                {t.autoApproveHint}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>{t.aliases}</Label>
              <div className="flex flex-wrap gap-2">
                {aliases.map((alias) => (
                  <Badge key={alias} variant="secondary" className="gap-1">
                    {alias}
                    <button
                      onClick={() => removeAlias(alias)}
                      className="ms-1 rounded hover:bg-muted"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  value={newAlias}
                  onChange={(e) => setNewAlias(e.target.value)}
                  placeholder={t.addAliasPlaceholder}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addAlias();
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addAlias}
                >
                  {dict.common.add}
                </Button>
              </div>
            </div>

            {feedback && (
              <div
                className={`rounded-md p-2 text-sm ${
                  feedback.type === "success"
                    ? "bg-green-50 text-green-700"
                    : "bg-red-50 text-red-700"
                }`}
              >
                {feedback.message}
              </div>
            )}

            <Button onClick={handleSave} disabled={loading}>
              {loading ? (
                <Loader2 className="me-1 h-4 w-4 animate-spin" />
              ) : (
                <Save className="me-1 h-4 w-4" />
              )}
              {t.saveVendor}
            </Button>
          </CardContent>
        </Card>

        {/* Extraction notes (plain text — used when the text extraction model runs) */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">{t.extractionNotes}</CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowNewRule(true)}
              >
                <Plus className="me-1 h-4 w-4" />
                {t.addNotes}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {showNewRule && (
              <div className="mb-4">
                <RuleEditor
                  vendorId={vendor.id}
                  onSaved={() => {
                    setShowNewRule(false);
                    router.refresh();
                  }}
                  onCancel={() => setShowNewRule(false)}
                />
              </div>
            )}

            {extractionRules.length === 0 && !showNewRule ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {t.noNotes}
              </p>
            ) : (
              <div className="space-y-3">
                {extractionRules.map((rule) => (
                  <RuleEditor
                    key={rule.id}
                    vendorId={vendor.id}
                    rule={rule}
                    onSaved={() => router.refresh()}
                    onCancel={() => {}}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Expense Graph */}
      <VendorExpenseChart invoices={invoices} />

      {/* Vendor Invoices */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {format(t.invoicesTitle, { count: invoices.length })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <InvoiceTable invoices={invoices} showStatusActions />
        </CardContent>
      </Card>
    </div>
  );
}
