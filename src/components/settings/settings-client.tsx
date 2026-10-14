"use client";

import { type ReactNode, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  FileText,
  Plus,
  DollarSign,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { RuleEditor } from "@/features/expenses/components/vendors/rule-editor";
import { updateVendor } from "@/features/expenses/actions/vendor-actions";
import { updateAutoApprovePromptPreferenceAction } from "@/actions/user-preferences-actions";
import { useI18n } from "@/lib/i18n/client";

interface VendorInfo {
  id: string;
  name: string;
  isIncomeSource: boolean;
  invoiceCount: number;
}

interface GlobalExtractionRuleRow {
  id: string;
  vendorId: string | null;
  name: string | null;
  priority: number | null;
  rules: Record<string, unknown>;
  isActive: boolean | null;
}

interface Props {
  allVendors: VendorInfo[];
  globalExtractionRules: GlobalExtractionRuleRow[];
  suppressAutoApprovePrompt: boolean;
}

export function SettingsClient({
  allVendors,
  globalExtractionRules,
  suppressAutoApprovePrompt,
}: Props) {
  const router = useRouter();
  const { dict } = useI18n();
  const tRules = dict.settings.extractionRules;
  const tIncome = dict.settings.incomeSources;
  const tAutoApprove = dict.settings.autoApprovePrompt;
  const [, startTransition] = useTransition();
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [showNewGlobalRule, setShowNewGlobalRule] = useState(false);
  const [showAllIncome, setShowAllIncome] = useState(false);
  const [suppressPrompt, setSuppressPrompt] = useState(suppressAutoApprovePrompt);
  const [savingAutoApprove, setSavingAutoApprove] = useState(false);

  async function handleToggleAutoApprovePrompt(checked: boolean) {
    const nextSuppress = !checked;
    setSavingAutoApprove(true);
    setSuppressPrompt(nextSuppress);
    try {
      const result = await updateAutoApprovePromptPreferenceAction(nextSuppress);
      if (!result.ok) {
        setSuppressPrompt(!nextSuppress);
        setFeedback({ type: "error", message: result.error });
      }
    } catch (err) {
      setSuppressPrompt(!nextSuppress);
      setFeedback({
        type: "error",
        message:
          err instanceof Error ? err.message : tAutoApprove.toggleFailed,
      });
    } finally {
      setSavingAutoApprove(false);
    }
  }

  async function handleToggleIncomeSource(vendorId: string, current: boolean) {
    setLoadingAction(`vendor-${vendorId}`);
    try {
      await updateVendor(vendorId, { isIncomeSource: !current });
      startTransition(() => router.refresh());
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : tIncome.toggleFailed,
      });
    } finally {
      setLoadingAction(null);
    }
  }

  const incomeVendors = allVendors.filter((v) => v.isIncomeSource);
  const nonIncomeVendors = allVendors.filter((v) => !v.isIncomeSource);

  return (
    <div className="space-y-6">
      {feedback && (
        <div
          className={`rounded-md p-3 text-sm ${
            feedback.type === "success"
              ? "bg-green-50 text-green-700"
              : "bg-red-50 text-red-700"
          }`}
        >
          {feedback.message}
        </div>
      )}

      {/* Auto-approve prompt preference */}
      <Card>
        <CardHeader>
          <CardTitle>{tAutoApprove.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              {tAutoApprove.description}
            </p>
            <Switch
              checked={!suppressPrompt}
              disabled={savingAutoApprove}
              onCheckedChange={handleToggleAutoApprovePrompt}
            />
          </div>
        </CardContent>
      </Card>

      {/* General extraction notes */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {tRules.title}
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowNewGlobalRule(true)}
            >
              <Plus className="me-1 h-4 w-4" />
              {tRules.addNotes}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            {tRules.description}
          </p>
          {showNewGlobalRule && (
            <div className="mb-4">
              <RuleEditor
                vendorId={null}
                onSaved={() => {
                  setShowNewGlobalRule(false);
                  router.refresh();
                }}
                onCancel={() => setShowNewGlobalRule(false)}
              />
            </div>
          )}
          {globalExtractionRules.length === 0 && !showNewGlobalRule ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {tRules.empty}
            </p>
          ) : (
            <div className="space-y-3">
              {globalExtractionRules.map((rule) => (
                <RuleEditor
                  key={rule.id}
                  vendorId={null}
                  rule={{
                    id: rule.id,
                    vendorId: rule.vendorId,
                    name: rule.name,
                    priority: rule.priority,
                    rules: rule.rules,
                    isActive: rule.isActive,
                  }}
                  onSaved={() => router.refresh()}
                  onCancel={() => {}}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Income Sources */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            {tIncome.title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            {tIncome.description}
          </p>

          {allVendors.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {tIncome.noVendors}
            </p>
          ) : (
            <div className="space-y-2">
              {incomeVendors.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">
                  {tIncome.noIncomeSources}
                </p>
              ) : (
                incomeVendors.map((vendor) => (
                  <VendorToggleRow
                    key={vendor.id}
                    vendor={vendor}
                    checked={true}
                    loading={loadingAction === `vendor-${vendor.id}`}
                    onToggle={() =>
                      handleToggleIncomeSource(
                        vendor.id,
                        vendor.isIncomeSource
                      )
                    }
                    badge={
                      <Badge className="bg-green-100 text-green-800">
                        {tIncome.incomeBadge}
                      </Badge>
                    }
                  />
                ))
              )}

              {nonIncomeVendors.length > 0 && (
                <div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2 text-muted-foreground"
                    onClick={() => setShowAllIncome(!showAllIncome)}
                  >
                    {showAllIncome ? (
                      <ChevronUp className="me-1 h-4 w-4" />
                    ) : (
                      <ChevronDown className="me-1 h-4 w-4" />
                    )}
                    {(() => {
                      const count = nonIncomeVendors.length;
                      if (showAllIncome) {
                        return count === 1
                          ? tIncome.hideOne
                          : tIncome.hideMany.replace("{count}", String(count));
                      }
                      return count === 1
                        ? tIncome.showOne
                        : tIncome.showMany.replace("{count}", String(count));
                    })()}
                  </Button>
                  {showAllIncome && (
                    <div className="mt-2 space-y-2">
                      {nonIncomeVendors.map((vendor) => (
                        <VendorToggleRow
                          key={vendor.id}
                          vendor={vendor}
                          checked={false}
                          loading={loadingAction === `vendor-${vendor.id}`}
                          onToggle={() =>
                            handleToggleIncomeSource(
                              vendor.id,
                              vendor.isIncomeSource
                            )
                          }
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function VendorToggleRow({
  vendor,
  checked,
  loading,
  onToggle,
  badge,
}: {
  vendor: VendorInfo;
  checked: boolean;
  loading: boolean;
  onToggle: () => void;
  badge?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border p-3">
      <div className="flex items-center gap-2">
        <Link
          href={`/vendors/${vendor.id}`}
          className="text-sm font-medium text-primary hover:underline"
        >
          {vendor.name}
        </Link>
        {badge}
      </div>
      <Switch checked={checked} disabled={loading} onCheckedChange={onToggle} />
    </div>
  );
}
