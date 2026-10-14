"use client";

import {
  buildBankTransferBlock,
  documentTypeShowsBankDetails,
} from "@/lib/documents/bank-details";
import {
  FooterCard,
  FooterPairs,
} from "@/features/generator/components/outbound/footer-card";
import type { InvoiceData, TemplateConfig } from "@/types/template";

/**
 * Rendered bank-transfer block for the on-screen preview. The HTML-string
 * renderer in `src/lib/pdf/render-invoice-html.ts`
 * (`renderBankDetailsBlock`) mirrors this layout for the PDF path — keep
 * them visually consistent.
 *
 * Renders last in the document body, just above the signature / QR footer,
 * and returns null on document types that evidence payment already received,
 * so this block and `PaymentBlock` never both show.
 */

interface Props {
  config: TemplateConfig;
  invoice: InvoiceData;
}

export function BankDetailsBlock({ config, invoice }: Props) {
  if (!config.showBankDetails) return null;
  if (!documentTypeShowsBankDetails(invoice.documentType)) return null;
  const lang = invoice.language === "he" ? "he" : "en";
  const block = buildBankTransferBlock(config.bankDetails, lang);
  if (!block) return null;

  return (
    <FooterCard accentColor={config.accentColor} title={block.title}>
      <FooterPairs pairs={block.lines} />
      {block.note && (
        <p className="mt-1.5 whitespace-pre-line text-gray-500">{block.note}</p>
      )}
    </FooterCard>
  );
}
