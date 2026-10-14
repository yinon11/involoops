"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { Plus, Loader2 } from "lucide-react";
import { createCustomer } from "@/features/generator/actions/customer-actions";
import { useI18n } from "@/lib/i18n/client";

interface Props {
  labels: {
    triggerLabel: string;
    title: string;
    description: string;
    namePh: string;
    emailPh: string;
    phonePh: string;
    taxIdPh: string;
    addressPh: string;
    notesPh: string;
    submit: string;
    submitting: string;
    cancel: string;
    errorNameRequired: string;
    errorCreateFailed: string;
  };
  variant?: "primary" | "ghost";
  /** When provided, navigate here with the new customer's id appended. */
  redirectToDetail?: boolean;
}

export function CustomerCreateDialog({
  labels,
  variant = "primary",
  redirectToDetail = true,
}: Props) {
  const router = useRouter();
  const { dict } = useI18n();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [taxId, setTaxId] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setEmail("");
    setPhone("");
    setTaxId("");
    setAddress("");
    setNotes("");
    setError(null);
  }

  async function handleCreate() {
    if (!name.trim()) {
      setError(labels.errorNameRequired);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const row = await createCustomer({
        name: name.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        taxId: taxId.trim() || undefined,
        address: address.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      setOpen(false);
      reset();
      if (redirectToDetail && row?.id) {
        router.push(`/customers/${row.id}`);
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : labels.errorCreateFailed);
    } finally {
      setLoading(false);
    }
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
        <Button size="sm" variant={variant === "ghost" ? "outline" : "default"}>
          <Plus className="me-1 h-4 w-4" />
          {labels.triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="customer-name">{labels.namePh}</Label>
            <Input
              id="customer-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="customer-email">{labels.emailPh}</Label>
              <Input
                id="customer-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="customer-phone">{labels.phonePh}</Label>
              <Input
                id="customer-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="customer-taxid">{labels.taxIdPh}</Label>
            <Input
              id="customer-taxid"
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {dict.customers.create.taxIdHelperText}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="customer-address">{labels.addressPh}</Label>
            <Input
              id="customer-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="customer-notes">{labels.notesPh}</Label>
            <Textarea
              id="customer-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          {error && (
            <div className="rounded-md bg-red-50 p-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={loading}
          >
            {labels.cancel}
          </Button>
          <Button onClick={handleCreate} disabled={!name.trim() || loading}>
            {loading && <Loader2 className="me-1 h-4 w-4 animate-spin" />}
            {loading ? labels.submitting : labels.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
