"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast as sonnerToast } from "sonner";
import { displayDocumentNumber } from "@/lib/documents/display-number";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowLeft, FilePlus2, Loader2, Trash2 } from "lucide-react";
import {
  DocumentStatusChip,
  type ShaamStatus,
} from "@/features/generator/components/outbound/document-status-chip";
import { updateCustomer, deleteCustomer } from "@/features/generator/actions/customer-actions";
import { deleteOutboundInvoice } from "@/features/generator/actions/outbound-invoice-actions";
import { useI18n } from "@/lib/i18n/client";
import type { OutboundInvoiceStatus } from "@/db/schema/outbound-invoices";

export interface CustomerDetail {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  taxId: string | null;
  notes: string | null;
}

export interface CustomerInvoiceRow {
  // (id, etc. continued below — `formattedNumber` is null for drafts that
  // haven't been issued yet; we render a `DRAFT-…` placeholder.)
  id: string;
  formattedNumber: string | null;
  documentType: string;
  invoiceDate: string;
  total: string;
  currency: string | null;
  status: OutboundInvoiceStatus | null;
  shaamStatus: ShaamStatus;
}

interface Labels {
  back: string;
  editTitle: string;
  editSubtitle: string;
  save: string;
  saving: string;
  delete: string;
  deleteConfirmTitle: string;
  deleteConfirmBody: string;
  deleteConfirmCta: string;
  cancel: string;
  saved: string;
  saveFailed: string;
  deleted: string;
  deleteFailed: string;
  namePh: string;
  emailPh: string;
  phonePh: string;
  taxIdPh: string;
  addressPh: string;
  notesPh: string;
  createInvoiceCta: string;
  invoicesTitle: string;
  invoicesSubtitle: string;
  invoicesEmpty: string;
  invoicesCols: {
    number: string;
    type: string;
    date: string;
    total: string;
    status: string;
  };
  stats: {
    total: string;
    issued: string;
    drafts: string;
    lifetimeValue: string;
  };
}

export function CustomerDetailClient({
  customer,
  invoices,
  labels,
}: {
  customer: CustomerDetail;
  invoices: CustomerInvoiceRow[];
  labels: Labels;
}) {
  const router = useRouter();
  const { dict } = useI18n();
  const [name, setName] = useState(customer.name);
  const [email, setEmail] = useState(customer.email ?? "");
  const [phone, setPhone] = useState(customer.phone ?? "");
  const [taxId, setTaxId] = useState(customer.taxId ?? "");
  const [address, setAddress] = useState(customer.address ?? "");
  const [notes, setNotes] = useState(customer.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const dirty =
    name !== customer.name ||
    email !== (customer.email ?? "") ||
    phone !== (customer.phone ?? "") ||
    taxId !== (customer.taxId ?? "") ||
    address !== (customer.address ?? "") ||
    notes !== (customer.notes ?? "");

  const issuedCount = invoices.filter((i) => i.status !== "draft").length;
  const draftCount = invoices.filter((i) => i.status === "draft").length;
  const lifetimeByCurrency = invoices.reduce<Record<string, number>>(
    (acc, inv) => {
      const cur = inv.currency ?? "ILS";
      acc[cur] = (acc[cur] ?? 0) + Number(inv.total ?? 0);
      return acc;
    },
    {},
  );

  async function handleSave() {
    if (!name.trim()) {
      setError(labels.namePh);
      return;
    }
    setSaving(true);
    setError(null);
    setToast(null);
    try {
      await updateCustomer(customer.id, {
        name: name.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        taxId: taxId.trim() || undefined,
        address: address.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      setToast(labels.saved);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : labels.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await deleteCustomer(customer.id);
      router.push("/customers");
    } catch (err) {
      setError(err instanceof Error ? err.message : labels.deleteFailed);
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <Link
            href="/customers"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {labels.back}
          </Link>
          <h1 className="text-2xl font-semibold">{customer.name}</h1>
          {customer.email && (
            <p className="text-sm text-muted-foreground">{customer.email}</p>
          )}
        </div>
        <Link href={`/outbound/new?customerId=${customer.id}`}>
          <Button>
            <FilePlus2 className="me-1 h-4 w-4" />
            {labels.createInvoiceCta}
          </Button>
        </Link>
      </div>

      <section className="grid gap-4 sm:grid-cols-4">
        <Stat label={labels.stats.total} value={String(invoices.length)} />
        <Stat label={labels.stats.issued} value={String(issuedCount)} />
        <Stat label={labels.stats.drafts} value={String(draftCount)} />
        <Stat
          label={labels.stats.lifetimeValue}
          value={
            Object.keys(lifetimeByCurrency).length === 0
              ? "—"
              : Object.entries(lifetimeByCurrency)
                  .map(([cur, total]) => `${total.toLocaleString()} ${cur}`)
                  .join(" · ")
          }
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{labels.editTitle}</CardTitle>
          <p className="text-sm text-muted-foreground">{labels.editSubtitle}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-name">{labels.namePh}</Label>
              <Input
                id="edit-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-taxid">{labels.taxIdPh}</Label>
              <Input
                id="edit-taxid"
                value={taxId}
                onChange={(e) => setTaxId(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {dict.customers.create.taxIdHelperText}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-email">{labels.emailPh}</Label>
              <Input
                id="edit-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-phone">{labels.phonePh}</Label>
              <Input
                id="edit-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-address">{labels.addressPh}</Label>
            <Input
              id="edit-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-notes">{labels.notesPh}</Label>
            <Textarea
              id="edit-notes"
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
          {toast && (
            <div className="rounded-md bg-emerald-50 p-2 text-sm text-emerald-700">
              {toast}
            </div>
          )}
          <div className="flex items-center justify-between pt-2">
            <Button
              variant="outline"
              className="text-red-700 hover:bg-red-50 hover:text-red-800"
              onClick={() => setDeleteOpen(true)}
              disabled={saving}
            >
              <Trash2 className="me-1 h-4 w-4" />
              {labels.delete}
            </Button>
            <Button onClick={handleSave} disabled={!dirty || !name.trim() || saving}>
              {saving && <Loader2 className="me-1 h-4 w-4 animate-spin" />}
              {saving ? labels.saving : labels.save}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{labels.invoicesTitle}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {labels.invoicesSubtitle}
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {invoices.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">
              {labels.invoicesEmpty}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{labels.invoicesCols.number}</TableHead>
                  <TableHead>{labels.invoicesCols.type}</TableHead>
                  <TableHead>{labels.invoicesCols.date}</TableHead>
                  <TableHead className="text-end">
                    {labels.invoicesCols.total}
                  </TableHead>
                  <TableHead>{labels.invoicesCols.status}</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow
                    key={inv.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => router.push(`/outbound/${inv.id}`)}
                  >
                    <TableCell className="font-mono font-medium">
                      <Link
                        href={`/outbound/${inv.id}`}
                        className="text-primary hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {displayDocumentNumber(inv)}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className="bg-indigo-50 text-indigo-700"
                      >
                        {dict.documents.type[
                          inv.documentType as keyof typeof dict.documents.type
                        ] ?? inv.documentType}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{inv.invoiceDate}</TableCell>
                    <TableCell className="text-end font-medium tabular-nums">
                      {Number(inv.total).toLocaleString()} {inv.currency ?? ""}
                    </TableCell>
                    <TableCell>
                      <DocumentStatusChip
                        status={inv.status ?? "draft"}
                        shaamStatus={inv.shaamStatus}
                        dict={dict}
                        size="sm"
                      />
                    </TableCell>
                    <TableCell className="text-end">
                      {(inv.status ?? "draft") === "draft" && !inv.formattedNumber && (
                        <InvoiceDraftDeleteButton
                          id={inv.id}
                          label={dict.outbound.list.deleteDraft}
                          confirmText={dict.outbound.list.deleteDraftConfirm}
                          cancelLabel={dict.common.cancel}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{labels.deleteConfirmTitle}</DialogTitle>
            <DialogDescription>{labels.deleteConfirmBody}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={deleting}
            >
              {labels.cancel}
            </Button>
            <Button
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="me-1 h-4 w-4 animate-spin" />}
              {labels.deleteConfirmCta}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InvoiceDraftDeleteButton({
  id,
  label,
  confirmText,
  cancelLabel,
}: {
  id: string;
  label: string;
  confirmText: string;
  cancelLabel: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    sonnerToast(confirmText, {
      action: {
        label,
        onClick: () => {
          startTransition(async () => {
            try {
              await deleteOutboundInvoice(id);
              router.refresh();
            } catch (err) {
              sonnerToast.error(
                err instanceof Error ? err.message : String(err),
              );
            }
          });
        },
      },
      cancel: { label: cancelLabel, onClick: () => {} },
    });
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleDelete}
      disabled={isPending}
      aria-label={label}
      className="gap-1 text-red-600 hover:bg-red-50 hover:text-red-700"
    >
      {isPending ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Trash2 className="h-3 w-3" />
      )}
      {label}
    </Button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
        {value}
      </p>
    </div>
  );
}
