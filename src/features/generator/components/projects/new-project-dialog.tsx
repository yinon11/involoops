"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createProject } from "@/features/generator/actions/project-actions";
import { DatePicker } from "@/components/ui/date-picker";

interface CustomerOption {
  id: string;
  name: string;
}

interface MilestoneInput {
  title: string;
  amount: string;
  dueDate: string;
}

interface NewProjectLabels {
  newProject: string;
  newProjectTitle: string;
  newProjectDesc: string;
  fieldName: string;
  fieldNamePh: string;
  fieldCustomer: string;
  noCustomer: string;
  fieldCurrency: string;
  fieldTotal: string;
  fieldStartDate: string;
  fieldNotes: string;
  fieldNotesPlaceholder: string;
  billingMilestones: string;
  addMilestone: string;
  noMilestonesHint: string;
  milestoneTitlePh: string;
  milestoneAmountPh: string;
  milestoneTotal: string;
  creating: string;
  createProject: string;
  errNameRequired: string;
  errAmountRequired: string;
  errMilestoneAmount: string;
  errMilestoneOverBudget: string;
  errFailedCreate: string;
  cancelNotes: string;
}

interface NewProjectDialogProps {
  customers: CustomerOption[];
  labels: NewProjectLabels;
}

const CURRENCIES = ["ILS", "USD", "EUR", "GBP"];

export function NewProjectDialog({ customers, labels }: NewProjectDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Project fields
  const [name, setName] = useState("");
  const [customerId, setCustomerId] = useState<string>("__none__");
  const [totalAmount, setTotalAmount] = useState("");
  const [currency, setCurrency] = useState("ILS");
  const [startDate, setStartDate] = useState("");
  const [notes, setNotes] = useState("");

  // Milestone rows
  const [milestones, setMilestones] = useState<MilestoneInput[]>([]);

  function reset() {
    setName("");
    setCustomerId("__none__");
    setTotalAmount("");
    setCurrency("ILS");
    setStartDate("");
    setNotes("");
    setMilestones([]);
    setError(null);
  }

  function addMilestoneRow() {
    setMilestones((prev) => [
      ...prev,
      { title: "", amount: "", dueDate: "" },
    ]);
  }

  function removeMilestoneRow(idx: number) {
    setMilestones((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateMilestoneRow(
    idx: number,
    patch: Partial<MilestoneInput>,
  ) {
    setMilestones((prev) =>
      prev.map((m, i) => (i === idx ? { ...m, ...patch } : m)),
    );
  }

  const total = parseFloat(totalAmount) || 0;
  const milestoneSum = milestones.reduce(
    (s, m) => s + (parseFloat(m.amount) || 0),
    0,
  );
  const milestoneOverBudget = milestones.length > 0 && milestoneSum > total + 0.01;

  function handleCreate() {
    if (!name.trim()) {
      setError(labels.errNameRequired);
      return;
    }
    if (total <= 0) {
      setError(labels.errAmountRequired);
      return;
    }
    const validMilestones = milestones.filter(
      (m) => m.title.trim() && m.dueDate,
    );
    for (const m of validMilestones) {
      if ((parseFloat(m.amount) || 0) <= 0) {
        setError(labels.errMilestoneAmount);
        return;
      }
    }
    if (milestoneOverBudget) {
      setError(labels.errMilestoneOverBudget);
      return;
    }
    setError(null);

    startTransition(async () => {
      try {
        const project = await createProject({
          name: name.trim(),
          customerId: customerId === "__none__" ? undefined : customerId,
          totalAmount: total,
          currency,
          startDate: startDate || undefined,
          notes: notes.trim() || undefined,
          milestones: validMilestones.map((m) => ({
            title: m.title.trim(),
            amount: parseFloat(m.amount),
            dueDate: m.dueDate,
          })),
        });
        setOpen(false);
        reset();
        router.push(`/outbound/projects/${project.id}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : labels.errFailedCreate);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="bg-violet-600 text-white hover:bg-violet-700">
          <Plus className="me-1.5 h-4 w-4" />
          {labels.newProject}
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{labels.newProjectTitle}</DialogTitle>
          <DialogDescription>{labels.newProjectDesc}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="proj-name">{labels.fieldName} *</Label>
            <Input
              id="proj-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={labels.fieldNamePh}
              autoFocus
            />
          </div>

          {/* Customer */}
          <div className="space-y-1.5">
            <Label>{labels.fieldCustomer}</Label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger>
                <SelectValue placeholder={labels.noCustomer} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{labels.noCustomer}</SelectItem>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Total + Currency + Start date */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-1">
              <Label htmlFor="proj-currency">{labels.fieldCurrency}</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id="proj-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-1">
              <Label htmlFor="proj-total">{labels.fieldTotal} *</Label>
              <Input
                id="proj-total"
                type="number"
                min={0}
                step={0.01}
                value={totalAmount}
                onChange={(e) => setTotalAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-1">
              <Label htmlFor="proj-start">{labels.fieldStartDate}</Label>
              <DatePicker
                id="proj-start"
                value={startDate}
                onChange={setStartDate}
              />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="proj-notes">{labels.fieldNotes}</Label>
            <Textarea
              id="proj-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={labels.fieldNotesPlaceholder}
            />
          </div>

          {/* Milestones section */}
          <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50 p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-700">
                {labels.billingMilestones}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={addMilestoneRow}
                className="h-7 gap-1.5 text-xs text-violet-700 hover:bg-violet-50"
              >
                <Plus className="h-3.5 w-3.5" />
                {labels.addMilestone}
              </Button>
            </div>

            {milestones.length === 0 ? (
              <p className="py-3 text-center text-xs text-slate-400">
                {labels.noMilestonesHint}
              </p>
            ) : (
              <div className="space-y-2">
                {milestones.map((m, idx) => (
                  <div
                    key={idx}
                    className="grid items-end gap-2 sm:grid-cols-[1fr_auto_auto_auto]"
                  >
                    <Input
                      placeholder={labels.milestoneTitlePh}
                      value={m.title}
                      onChange={(e) =>
                        updateMilestoneRow(idx, { title: e.target.value })
                      }
                      className="text-xs"
                    />
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      placeholder={labels.milestoneAmountPh}
                      value={m.amount}
                      onChange={(e) =>
                        updateMilestoneRow(idx, { amount: e.target.value })
                      }
                      className="w-28 text-xs"
                    />
                    <DatePicker
                      value={m.dueDate}
                      onChange={(v) => updateMilestoneRow(idx, { dueDate: v })}
                      className="text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => removeMilestoneRow(idx)}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}

                {/* Milestone sum indicator */}
                <div
                  className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs ${
                    milestoneOverBudget
                      ? "bg-red-50 text-red-700"
                      : "bg-violet-50 text-violet-700"
                  }`}
                >
                  {milestoneOverBudget && (
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  )}
                  {labels.milestoneTotal}{" "}
                  <span className="font-semibold tabular-nums">
                    {milestoneSum.toLocaleString(undefined, {
                      maximumFractionDigits: 2,
                    })}{" "}
                    / {total.toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
                    {currency}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            {labels.cancelNotes}
          </Button>
          <Button
            onClick={handleCreate}
            disabled={isPending || !name.trim() || total <= 0 || milestoneOverBudget}
            className="bg-violet-600 text-white hover:bg-violet-700"
          >
            {isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
            {isPending ? labels.creating : labels.createProject}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
