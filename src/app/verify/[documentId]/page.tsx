import { verifyDocumentSignature } from "@/lib/signing/verify";
import { getDictionary } from "@/lib/i18n/server";
import { ShieldCheck, ShieldAlert, ShieldX } from "lucide-react";

export const metadata = {
  title: "Verify invoice",
  robots: { index: false, follow: false },
};

/**
 * Public signature-verification landing page.
 *
 * Reveals only what is already visible on the printed invoice: the
 * formatted number, issuer legal name, customer name (if present),
 * issue date, grand total, currency, and the signing metadata
 * (timestamp + key id + hash prefix). Nothing else from the database
 * leaks here.
 */
export default async function VerifyDocumentPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const { documentId } = await params;
  const dict = await getDictionary();
  const result = await verifyDocumentSignature(documentId);

  if (result.ok) {
    const stamp = result.signedAt
      .toISOString()
      .replace("T", " ")
      .slice(0, 19);
    return (
      <main className="min-h-screen bg-gray-50 py-12">
        <div className="mx-auto max-w-xl rounded-xl border bg-white p-8 shadow-sm">
          <div className="mb-6 flex items-center gap-3 text-green-700">
            <ShieldCheck className="h-8 w-8" />
            <h1 className="text-xl font-bold">{dict.verify.page.title}</h1>
          </div>
          <p className="mb-6 text-sm text-green-700">
            {dict.verify.result.verified}
          </p>

          <dl className="divide-y text-sm">
            <Row label={dict.verify.field.formattedNumber} value={result.formattedNumber} mono />
            <Row label={dict.verify.field.issuer} value={result.businessEntityLegalName} />
            <Row
              label={dict.verify.field.customer}
              value={result.customerName ?? "—"}
            />
            <Row label={dict.verify.field.issueDate} value={result.issueDate.slice(0, 10)} />
            <Row
              label={dict.verify.field.total}
              value={`${result.grandTotal} ${result.currency}`}
            />
            <Row
              label={dict.verify.field.signedAt}
              value={`${stamp} UTC`}
              mono
            />
            <Row label={dict.verify.field.keyId} value={result.keyId} mono />
          </dl>
        </div>
      </main>
    );
  }

  const reason = result.reason;
  const notFound =
    reason === "signature_not_found" || reason === "key_not_found";
  return (
    <main className="min-h-screen bg-gray-50 py-12">
      <div className="mx-auto max-w-xl rounded-xl border bg-white p-8 shadow-sm">
        <div
          className={
            "mb-6 flex items-center gap-3 " +
            (notFound ? "text-gray-500" : "text-red-700")
          }
        >
          {notFound ? (
            <ShieldX className="h-8 w-8" />
          ) : (
            <ShieldAlert className="h-8 w-8" />
          )}
          <h1 className="text-xl font-bold">{dict.verify.page.title}</h1>
        </div>
        <p className="text-sm">
          {notFound
            ? dict.verify.page.notFound
            : reason === "key_revoked"
              ? dict.verify.result.revoked
              : reason === "signature_invalid"
                ? dict.verify.result.invalid
                : dict.verify.result.modified}
        </p>
      </div>
    </main>
  );
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <dt className="text-gray-500">{label}</dt>
      <dd className={mono ? "font-mono text-xs" : "font-medium"}>{value}</dd>
    </div>
  );
}
