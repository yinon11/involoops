import { readFile } from "node:fs/promises";
import iconv from "iconv-lite";
import { and, asc, eq, gte, isNotNull, lte, ne } from "drizzle-orm";
import { db } from "@/db";
import { businessEntities, outboundInvoices } from "@/db/schema";
import { addMoney } from "@/lib/money";
import { toStatutoryIlsAmounts } from "@/lib/outbound/statutory-ils-amounts";
import { APPENDIX1_DOCUMENT_TYPES } from "./appendix1-document-types";
import { A000_FIELDS } from "./records/a000";
import { C100_FIELDS, documentTypeToCode } from "./records/c100";
import {
  UNIFORM_STRUCTURE_ENCODING,
  getSoftwareName,
  getSoftwareRegistrationCode,
  getSoftwareVersion,
} from "./types";

export interface Section26Row {
  code: string;
  labelHe: string;
  quantity: number;
  /** Total including VAT in ILS (integer shekels for display). */
  totalIls: number;
  notes: string;
}

export interface Section26Report {
  taxpayerName: string;
  taxpayerVat: string;
  periodStart: string;
  periodEnd: string;
  producedAt: Date;
  softwareName: string;
  softwareVersion: string;
  softwareRegistrationCode: string;
  rows: Section26Row[];
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function absoluteMoney(value: string): string {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return "0.00";
  return Math.abs(n).toFixed(2);
}

function moneyToDisplayShekels(value: string): number {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.abs(n));
}

function sliceField(
  line: string,
  start1: number,
  length: number,
): string {
  return line.slice(start1 - 1, start1 - 1 + length);
}

function parseSignedAmount(raw: string, decimals = 2): number {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.replace(/[+0]/g, "").length === 0) return 0;
  const sign = trimmed.startsWith("-") ? -1 : 1;
  const digits = trimmed.replace(/^[+-]/, "").replace(/\D/g, "");
  if (!digits) return 0;
  const n = Number.parseInt(digits, 10) / 10 ** decimals;
  return sign * n;
}

function yyyymmddToIso(d: string): string {
  const t = d.trim();
  if (t.length !== 8) return t;
  return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
}

function fieldByName(
  fields: readonly { name: string; start: number; length: number }[],
  name: string,
): { start: number; length: number } {
  const f = fields.find((x) => x.name === name);
  if (!f) throw new Error(`Field ${name} not found`);
  return f;
}

/**
 * Build §2.6(b) from an on-disk export (same INI/BKMVDATA as simulator).
 * Use when DB is unavailable — aggregates C100 rows only.
 */
export async function buildSection26ReportFromBuffers(params: {
  iniContent: Buffer;
  bkmvdataContent: Buffer;
}): Promise<Section26Report> {
  const iniText = iconv.decode(params.iniContent, UNIFORM_STRUCTURE_ENCODING);
  const bkmvText = iconv.decode(params.bkmvdataContent, UNIFORM_STRUCTURE_ENCODING);
  return buildSection26ReportFromDecoded({ iniText, bkmvText });
}

export async function buildSection26ReportFromExportFiles(params: {
  iniPath: string;
  bkmvdataPath: string;
}): Promise<Section26Report> {
  const iniBuf = await readFile(params.iniPath);
  const bkmvBuf = await readFile(params.bkmvdataPath);
  return buildSection26ReportFromBuffers({
    iniContent: iniBuf,
    bkmvdataContent: bkmvBuf,
  });
}

function buildSection26ReportFromDecoded(params: {
  iniText: string;
  bkmvText: string;
}): Section26Report {
  const iniText = params.iniText;
  const bkmvText = params.bkmvText;
  const a000Line = iniText.split(/\r?\n/).find((l) => l.startsWith("A000"));
  if (!a000Line) throw new Error("INI.TXT missing A000 record");

  const bn = fieldByName(A000_FIELDS, "businessName");
  const vn = fieldByName(A000_FIELDS, "vatNumber");
  const ps = fieldByName(A000_FIELDS, "dataPeriodStart");
  const pe = fieldByName(A000_FIELDS, "dataPeriodEnd");
  const pd = fieldByName(A000_FIELDS, "processStartDate");
  const pt = fieldByName(A000_FIELDS, "processStartTime");
  const sn = fieldByName(A000_FIELDS, "softwareName");
  const sv = fieldByName(A000_FIELDS, "softwareVersion");
  const rc = fieldByName(A000_FIELDS, "softwareRegistrationCode");

  const docTypeF = fieldByName(C100_FIELDS, "documentType");
  const inclF = fieldByName(C100_FIELDS, "amountIncludingVat");

  const qtyByCode = new Map<string, number>();
  const sumByCode = new Map<string, number>();

  for (const line of bkmvText.split(/\r?\n/)) {
    if (!line.startsWith("C100")) continue;
    const code = sliceField(line, docTypeF.start, docTypeF.length).trim();
    const inclRaw = sliceField(line, inclF.start, inclF.length);
    const incl = Math.abs(parseSignedAmount(inclRaw, 2));
    qtyByCode.set(code, (qtyByCode.get(code) ?? 0) + 1);
    sumByCode.set(code, (sumByCode.get(code) ?? 0) + incl);
  }

  const rows: Section26Row[] = APPENDIX1_DOCUMENT_TYPES.map(({ code, labelHe }) => {
    const quantity = qtyByCode.get(code) ?? 0;
    const totalIls = Math.round(sumByCode.get(code) ?? 0);
    let notes = "";
    if (code === "200" && quantity > 0 && totalIls === 0) {
      notes =
        "בתוכנה מנוהלות תעודות משלוח; אין בהן ציון סכומים כספיים במבנה האחיד.";
    }
    return { code, labelHe, quantity, totalIls, notes };
  });

  const dateStr = sliceField(a000Line, pd.start, pd.length);
  const timeStr = sliceField(a000Line, pt.start, pt.length);
  const producedAt = new Date(
    `${yyyymmddToIso(dateStr)}T${timeStr.slice(0, 2)}:${timeStr.slice(2, 4)}:00`,
  );

  return {
    taxpayerName: sliceField(a000Line, bn.start, bn.length).trim(),
    taxpayerVat: sliceField(a000Line, vn.start, vn.length).trim(),
    periodStart: yyyymmddToIso(sliceField(a000Line, ps.start, ps.length)),
    periodEnd: yyyymmddToIso(sliceField(a000Line, pe.start, pe.length)),
    producedAt,
    softwareName: sliceField(a000Line, sn.start, sn.length).trim(),
    softwareVersion: sliceField(a000Line, sv.start, sv.length).trim(),
    softwareRegistrationCode: sliceField(a000Line, rc.start, rc.length).trim(),
    rows,
  };
}

/**
 * §2.6(b) — document-type quantity / monetary summary for the same
 * date slice as a Uniform Structure export (issued docs with fiscal
 * numbers only).
 */
export async function buildSection26Report(params: {
  businessEntityId: string;
  periodStart: Date;
  periodEnd: Date;
}): Promise<Section26Report> {
  const [entity] = await db
    .select()
    .from(businessEntities)
    .where(eq(businessEntities.id, params.businessEntityId))
    .limit(1);
  if (!entity) {
    throw new Error(`Business entity not found: ${params.businessEntityId}`);
  }

  const invoices = await db
    .select()
    .from(outboundInvoices)
    .where(
      and(
        eq(outboundInvoices.businessEntityId, params.businessEntityId),
        gte(outboundInvoices.invoiceDate, toDateString(params.periodStart)),
        lte(outboundInvoices.invoiceDate, toDateString(params.periodEnd)),
        isNotNull(outboundInvoices.formattedNumber),
        ne(outboundInvoices.status, "draft"),
      ),
    )
    .orderBy(asc(outboundInvoices.invoiceDate), asc(outboundInvoices.sequenceNumber));

  const qtyByCode = new Map<string, number>();
  const sumByCode = new Map<string, string>();

  for (const invoice of invoices) {
    const code = documentTypeToCode(invoice.documentType);
    qtyByCode.set(code, (qtyByCode.get(code) ?? 0) + 1);
    const cancelled =
      invoice.status === "voided" ||
      invoice.shaamStatus === "CANCELLED_AFTER_REJECTION";
    if (cancelled) continue;

    const ils = toStatutoryIlsAmounts(invoice);
    const incl = absoluteMoney(String(ils.total));
    sumByCode.set(code, addMoney(sumByCode.get(code) ?? "0.00", incl));
  }

  const rows: Section26Row[] = APPENDIX1_DOCUMENT_TYPES.map(({ code, labelHe }) => {
    const quantity = qtyByCode.get(code) ?? 0;
    const totalIls = moneyToDisplayShekels(sumByCode.get(code) ?? "0");
    let notes = "";
    if (code === "200" && quantity > 0 && totalIls === 0) {
      notes =
        "בתוכנה מנוהלות תעודות משלוח; אין בהן ציון סכומים כספיים במבנה האחיד.";
    }
    return { code, labelHe, quantity, totalIls, notes };
  });

  return {
    taxpayerName: entity.legalName,
    taxpayerVat: entity.osekMurshe ?? "",
    periodStart: toDateString(params.periodStart),
    periodEnd: toDateString(params.periodEnd),
    producedAt: new Date(),
    softwareName: getSoftwareName(),
    softwareVersion: getSoftwareVersion(),
    softwareRegistrationCode: getSoftwareRegistrationCode(),
    rows,
  };
}

export function renderSection26ReportHtml(
  report: Section26Report,
  pageNumber = 1,
  totalPages = 1,
): string {
  const fmtDate = (iso: string) => {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  };
  const produced = report.producedAt;
  const producedStr = `${fmtDate(produced.toISOString().slice(0, 10))} ${String(produced.getHours()).padStart(2, "0")}:${String(produced.getMinutes()).padStart(2, "0")}`;

  const bodyRows = report.rows
    .map(
      (r) => `
    <tr>
      <td class="num">${r.code}</td>
      <td>${escapeHtml(r.labelHe)}</td>
      <td class="num">${r.quantity.toLocaleString("en-US")}</td>
      <td class="num">${r.totalIls.toLocaleString("en-US")}</td>
      <td class="notes">${escapeHtml(r.notes)}</td>
    </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>פלט לאימות נתונים — סעיף 2.6</title>
  <style>
    @page { size: A4; margin: 18mm 14mm; }
    body { font-family: Arial, "DejaVu Sans", sans-serif; font-size: 11pt; color: #111; }
    h1 { font-size: 16pt; margin: 0 0 8px; text-align: center; }
    h2 { font-size: 12pt; margin: 16px 0 8px; font-weight: bold; }
    .meta { margin-bottom: 12px; line-height: 1.5; }
    .meta span { display: inline-block; min-width: 140px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { border: 1px solid #333; padding: 4px 6px; vertical-align: top; }
    th { background: #eee; font-weight: bold; text-align: center; }
    td.num { text-align: center; font-variant-numeric: tabular-nums; }
    td.notes { font-size: 9pt; max-width: 180px; }
    .footer { margin-top: 20px; font-size: 9pt; text-align: center; border-top: 1px solid #999; padding-top: 8px; }
    .end-mark { font-weight: bold; margin-top: 12px; text-align: center; }
  </style>
</head>
<body>
  <h1>פלטים לאימות נתונים — סעיף 2.6(ב)</h1>
  <h2>הוראות להפקת קבצים במבנה אחיד (גרסה 1.31)</h2>
  <div class="meta">
    <div><span>שם הנישום:</span> ${escapeHtml(report.taxpayerName)}</div>
    <div><span>מספר עוסק:</span> ${escapeHtml(report.taxpayerVat)}</div>
    <div><span>תקופה:</span> ${fmtDate(report.periodStart)} — ${fmtDate(report.periodEnd)}</div>
    <div><span>מהות הפלט:</span> דוח סיכום לפי סוגי מסמכים (נספח 1)</div>
    <div><span>תאריך הפקה:</span> ${producedStr}</div>
    <div><span>תוכנה:</span> ${escapeHtml(report.softwareName)} ${escapeHtml(report.softwareVersion)} (מס׳ רישום ${escapeHtml(report.softwareRegistrationCode)})</div>
  </div>
  <table>
    <thead>
      <tr>
        <th>מספר המסמך</th>
        <th>סוג המסמך</th>
        <th>סה״כ כמותי</th>
        <th>סה״כ כספי (בש״ח)</th>
        <th>הערות</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows}
    </tbody>
  </table>
  <div class="end-mark">— סוף הפלט —</div>
  <div class="footer">עמוד ${pageNumber} מתוך ${totalPages} · InvoLoops · פלט המופק מהתוכנה</div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
