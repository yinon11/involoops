"use client";

/**
 * Shared chrome for the two footer blocks — `BankDetailsBlock` on
 * payment-request documents and `PaymentBlock` on receipts. They are mutually
 * exclusive by document type, so a document shows at most one, and both sit
 * last in the body just above the signature / QR footer.
 *
 * `break-words` is the backstop for a long unbroken value (an IBAN has no
 * spaces to break at) so text can never run past the border. Mirrors
 * `renderFooterCard` in `src/lib/pdf/render-invoice-html.ts`.
 */

interface Props {
  accentColor: string;
  title: string;
  /** Right-aligned value on the title row, e.g. the total paid. */
  aside?: React.ReactNode;
  children: React.ReactNode;
}

export function FooterCard({ accentColor, title, aside, children }: Props) {
  return (
    <section className="mt-8 break-inside-avoid break-words rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-xs leading-relaxed">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-semibold" style={{ color: accentColor }}>
          {title}
        </span>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Inline `label: value` pairs separated by a middot, as both cards use. */
export function FooterPairs({
  pairs,
}: {
  pairs: Array<{ label: string; value: string }>;
}) {
  return (
    <p className="text-gray-600">
      {pairs.map((pair, i) => (
        <span key={pair.label}>
          {i > 0 && <span className="text-gray-300"> &middot; </span>}
          <span className="text-gray-500">{pair.label}:</span>{" "}
          <span className="font-mono text-gray-800">{pair.value}</span>
        </span>
      ))}
    </p>
  );
}
