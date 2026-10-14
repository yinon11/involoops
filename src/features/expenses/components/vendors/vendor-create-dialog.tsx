"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Loader2 } from "lucide-react";
import { createVendor } from "@/features/expenses/actions/vendor-actions";
import { useI18n } from "@/lib/i18n/client";

export function VendorCreateDialog() {
  const router = useRouter();
  const { dict } = useI18n();
  const t = dict.vendors.create;
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [isIncomeSource, setIsIncomeSource] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await createVendor({
        name: name.trim(),
        defaultCategory: category.trim() || undefined,
        isIncomeSource,
      });
      setOpen(false);
      setName("");
      setCategory("");
      setIsIncomeSource(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.failed);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="me-1 h-4 w-4" />
          {t.addButton}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="vendor-name">{t.nameLabel}</Label>
            <Input
              id="vendor-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.namePlaceholder}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vendor-category">{t.categoryLabel}</Label>
            <Input
              id="vendor-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder={t.categoryPlaceholder}
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="income-source"
              checked={isIncomeSource}
              onCheckedChange={setIsIncomeSource}
            />
            <Label htmlFor="income-source">{t.incomeSource}</Label>
          </div>
          {error && (
            <div className="rounded-md bg-red-50 p-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t.cancel}
          </Button>
          <Button onClick={handleCreate} disabled={!name.trim() || loading}>
            {loading && <Loader2 className="me-1 h-4 w-4 animate-spin" />}
            {t.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
