"use client";

import { useState, useTransition } from "react";
import { Plus, Loader2, AlertCircle } from "lucide-react";
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
import { addMilestone } from "@/features/generator/actions/project-actions";
import { DatePicker } from "@/components/ui/date-picker";

interface AddMilestoneLabels {
  addMilestone: string;
  addMilestoneTitle: string;
  addMilestoneDesc: string;
  fieldMilestoneTitle: string;
  fieldMilestoneTitlePh: string;
  fieldAmount: string;
  fieldDueDate: string;
  fieldOptionalNotes: string;
  optionalNotesPh: string;
  adding: string;
  cancelNotes: string;
  errTitleRequired: string;
  errMilestoneAmountPos: string;
  errDueDateRequired: string;
  errFailedAdd: string;
}

interface AddMilestoneDialogProps {
  projectId: string;
  currency: string;
  labels: AddMilestoneLabels;
}

export function AddMilestoneDialog({
  projectId,
  currency,
  labels,
}: AddMilestoneDialogProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");

  function reset() {
    setTitle("");
    setAmount("");
    setDueDate("");
    setNotes("");
    setError(null);
  }

  function handleAdd() {
    if (!title.trim()) {
      setError(labels.errTitleRequired);
      return;
    }
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      setError(labels.errMilestoneAmountPos);
      return;
    }
    if (!dueDate) {
      setError(labels.errDueDateRequired);
      return;
    }
    setError(null);

    startTransition(async () => {
      try {
        await addMilestone(projectId, {
          title: title.trim(),
          amount: amt,
          dueDate,
          notes: notes.trim() || undefined,
        });
        setOpen(false);
        reset();
      } catch (e) {
        setError(e instanceof Error ? e.message : labels.errFailedAdd);
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
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 border-violet-200 text-violet-700 hover:bg-violet-50"
        >
          <Plus className="h-3.5 w-3.5" />
          {labels.addMilestone}
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>{labels.addMilestoneTitle}</DialogTitle>
          <DialogDescription>{labels.addMilestoneDesc}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ms-title">{labels.fieldMilestoneTitle} *</Label>
            <Input
              id="ms-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={labels.fieldMilestoneTitlePh}
              autoFocus
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ms-amount">{labels.fieldAmount} ({currency}) *</Label>
              <Input
                id="ms-amount"
                type="number"
                min={0}
                step={0.01}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ms-due">{labels.fieldDueDate} *</Label>
              <DatePicker
                id="ms-due"
                value={dueDate}
                onChange={setDueDate}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ms-notes">{labels.fieldOptionalNotes}</Label>
            <Textarea
              id="ms-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={labels.optionalNotesPh}
            />
          </div>

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
            onClick={handleAdd}
            disabled={isPending || !title.trim() || !dueDate}
            className="bg-violet-600 text-white hover:bg-violet-700"
          >
            {isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
            {isPending ? labels.adding : labels.addMilestone}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
