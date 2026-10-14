"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Save, X, Loader2, Trash2 } from "lucide-react";
import { saveVendorRule, deleteVendorRule } from "@/features/expenses/actions/vendor-actions";
import { useI18n } from "@/lib/i18n/client";

interface ExtractionRule {
  id: string;
  vendorId: string | null;
  name: string | null;
  priority: number | null;
  rules: Record<string, unknown>;
  isActive: boolean | null;
}

interface RuleEditorProps {
  /** `null` = global rule (all invoices). */
  vendorId: string | null;
  rule?: ExtractionRule;
  onSaved: () => void;
  onCancel: () => void;
}

interface RuleFormData {
  name: string;
  instructions: string;
}

function instructionsFromStoredRules(rules: Record<string, unknown>): string {
  const inst = rules.instructions;
  if (typeof inst === "string") return inst;
  return "";
}

function hasLegacyStructuredRules(rules: Record<string, unknown>): boolean {
  return Object.keys(rules).some((k) => k !== "instructions");
}

export function RuleEditor({
  vendorId,
  rule,
  onSaved,
  onCancel,
}: RuleEditorProps) {
  const { dict } = useI18n();
  const t = dict.settings.ruleEditor;
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(!rule);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const stored = (rule?.rules ?? {}) as Record<string, unknown>;
  const legacyNotice = rule && hasLegacyStructuredRules(stored);

  const { register, handleSubmit } = useForm<RuleFormData>({
    defaultValues: {
      name: rule?.name ?? "",
      instructions: instructionsFromStoredRules(stored),
    },
  });

  async function handleSave(data: RuleFormData) {
    setLoading(true);
    setFeedback(null);
    try {
      await saveVendorRule({
        id: rule?.id,
        vendorId,
        name: data.name || undefined,
        rules: {
          instructions: data.instructions,
        },
      });

      setFeedback({ type: "success", message: t.saved });
      setEditing(false);
      onSaved();
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : t.saveFailed,
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!rule?.id) return;
    setLoading(true);
    setFeedback(null);
    try {
      await deleteVendorRule(rule.id);
      setDeleteOpen(false);
      onSaved();
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : t.deleteFailed,
      });
    } finally {
      setLoading(false);
    }
  }

  const deleteDialog = (
    <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.deleteTitle}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t.deleteBody}</p>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setDeleteOpen(false)}
          >
            {t.cancel}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={loading}
            onClick={() => void handleDelete()}
          >
            {loading ? (
              <Loader2 className="me-1 h-4 w-4 animate-spin" />
            ) : null}
            {t.delete}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (!editing && rule) {
    const text = instructionsFromStoredRules(
      (rule.rules ?? {}) as Record<string, unknown>
    );
    const preview =
      text.trim().length > 160 ? `${text.trim().slice(0, 160)}…` : text.trim();

    return (
      <>
        <Card className="border-dashed">
          <CardContent className="space-y-2 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <span className="text-sm font-medium">
                  {rule.name?.trim() ||
                    t.defaultName.replace("{id}", rule.id.slice(0, 8))}
                </span>
                <Badge
                  variant={rule.isActive ? "default" : "secondary"}
                  className="ms-2"
                >
                  {rule.isActive ? t.active : t.inactive}
                </Badge>
                {preview ? (
                  <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                    {preview}
                  </p>
                ) : (
                  <p className="mt-2 text-sm italic text-muted-foreground">
                    {t.noNotes}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(true)}
                >
                  {t.edit}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10"
                  onClick={() => setDeleteOpen(true)}
                  title={t.deleteTooltip}
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="sr-only">{t.deleteSrLabel}</span>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
        {deleteDialog}
      </>
    );
  }

  return (
    <>
      <Card>
        <CardContent className="space-y-4 pt-4">
          <form onSubmit={handleSubmit(handleSave)} className="space-y-4">
            {vendorId === null && (
              <p className="text-xs text-muted-foreground">
                {t.generalApplies}
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="rule-name">{t.labelOptional}</Label>
              <Input
                id="rule-name"
                {...register("name")}
                placeholder={t.labelPlaceholder}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rule-instructions">{t.instructions}</Label>
              <Textarea
                id="rule-instructions"
                {...register("instructions")}
                placeholder={t.instructionsPlaceholder}
                rows={10}
                className="min-h-[200px] resize-y font-sans text-sm leading-relaxed"
              />
              {legacyNotice && (
                <p className="text-xs text-amber-800">{t.legacyNotice}</p>
              )}
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

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm" disabled={loading}>
                {loading ? (
                  <Loader2 className="me-1 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="me-1 h-4 w-4" />
                )}
                {t.save}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditing(false);
                  onCancel();
                }}
              >
                <X className="me-1 h-4 w-4" />
                {t.cancel}
              </Button>
              {rule?.id && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="ms-auto text-destructive hover:bg-destructive/10"
                  disabled={loading}
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="me-1 h-4 w-4" />
                  {t.delete}
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
      {deleteDialog}
    </>
  );
}
