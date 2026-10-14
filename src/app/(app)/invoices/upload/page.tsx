import Link from "next/link";
import { getInvoices } from "@/features/expenses/actions/invoice-actions";
import { UploadDropzone } from "@/features/expenses/components/invoices/upload-dropzone";
import { EmailForwardingCard } from "@/features/expenses/components/invoices/email-forwarding-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, FileText, CheckCircle, AlertCircle, Clock, Info } from "lucide-react";
import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getDictionary } from "@/lib/i18n/server";
import type { Dictionary } from "@/lib/i18n/dictionaries";

export default async function UploadPage() {
  const session = await auth();
  const userId = session?.user?.id;

  const [userRow, dict] = await Promise.all([
    userId
      ? db
          .select({ invoiceAlias: users.invoiceAlias })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    getDictionary(),
  ]);

  const t = dict.upload;
  let recentInvoices: Awaited<ReturnType<typeof getInvoices>> = [];
  let pendingInvoices: Awaited<ReturnType<typeof getInvoices>> = [];
  let listLoadError: string | null = null;
  try {
    [recentInvoices, pendingInvoices] = await Promise.all([
      getInvoices({ status: "processing" }),
      getInvoices({ status: "pending" }),
    ]);
  } catch (err) {
    console.error("[upload page] failed to load recent invoices:", err);
    listLoadError = t.errors.listLoadFailed;
  }

  const recentUploads = [...recentInvoices, ...pendingInvoices].slice(0, 10);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-highlight="page-upload">
          {t.title}
        </h1>
        <p className="mt-1 text-muted-foreground" data-highlight="upload-description">
          {t.description}
        </p>
      </div>

      <div className="flex gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>{t.inboundItaNote}</p>
      </div>

      {listLoadError ? (
        <div
          role="alert"
          className="flex gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>{listLoadError}</p>
        </div>
      ) : null}

      <EmailForwardingCard invoiceAlias={userRow?.invoiceAlias ?? null} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            {t.uploadFiles}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <UploadDropzone />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            {t.recentlyProcessed}
            {recentUploads.length > 0 && (
              <Badge variant="secondary">{recentUploads.length}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentUploads.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t.noRecentUploads}
            </p>
          ) : (
            <div className="space-y-2">
              {recentUploads.map((invoice) => (
                <div
                  key={invoice.id}
                  className="flex items-center gap-3 rounded-md border p-3"
                >
                  <FileText className="h-5 w-5 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {invoice.fileName ?? t.unnamedFile}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {invoice.vendorName ?? invoice.suggestedVendorName ?? t.unknownVendor} &middot;{" "}
                      {invoice.invoiceDate ?? t.noDate} &middot;{" "}
                      {invoice.amount
                        ? `${invoice.currency} ${parseFloat(invoice.amount).toFixed(2)}`
                        : t.noAmount}
                    </p>
                  </div>
                  <StatusBadge
                    status={invoice.status ?? "processing"}
                    invoiceId={invoice.id}
                    dict={dict}
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({
  status,
  invoiceId,
  dict,
}: {
  status: string;
  invoiceId: string;
  dict: Dictionary;
}) {
  const t = dict.upload;
  switch (status) {
    case "processing":
      return (
        <Badge variant="outline" className="gap-1">
          <AlertCircle className="h-3 w-3" />
          {t.status.processing}
        </Badge>
      );
    case "pending":
      return (
        <Link
          href={`/pending?invoice=${invoiceId}`}
          className="inline-flex shrink-0"
          title={t.openInPending}
        >
          <Badge variant="secondary" className="gap-1 hover:underline">
            <Clock className="h-3 w-3" />
            {t.status.pending}
          </Badge>
        </Link>
      );
    case "approved":
      return (
        <Badge variant="default" className="gap-1">
          <CheckCircle className="h-3 w-3" />
          {t.status.approved}
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}
