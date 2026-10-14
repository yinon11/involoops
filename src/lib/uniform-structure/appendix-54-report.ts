import { readFile } from "node:fs/promises";
import iconv from "iconv-lite";
import { A000_FIELDS } from "./records/a000";
import { INI_SUMMARY_TOTAL_LENGTH } from "./records/ini-summary";
import { UNIFORM_STRUCTURE_ENCODING } from "./types";

/** BKMVDATA record types listed in v1.31 Appendix 4 §5.4 (Hebrew labels). */
export const APPENDIX_54_RECORD_ROWS: ReadonlyArray<{
  code: string;
  labelHe: string;
}> = [
  { code: "A100", labelHe: "רשומה פתיחה" },
  { code: "B100", labelHe: "תנועות בהנהלת חשבונות" },
  { code: "B110", labelHe: "חשבון בהנהלת חשבונות" },
  { code: "C100", labelHe: "כותרת מסמך" },
  { code: "D110", labelHe: "פרטי מסמך" },
  { code: "D120", labelHe: "פרטי קבלות / הפקדה" },
  { code: "M100", labelHe: "פריטים במלאי" },
  { code: "Z900", labelHe: "רשומת סיום" },
];

export interface Appendix54RecordRow {
  code: string;
  labelHe: string;
  count: number;
}

export interface Appendix54Report {
  taxpayerVat: string;
  taxpayerName: string;
  filePath: string;
  periodStart: string;
  periodEnd: string;
  softwareType: string;
  softwareName: string;
  softwareRegistrationCode: string;
  producedAt: Date;
  recordRows: Appendix54RecordRow[];
}

function sliceField(line: string, start1: number, length: number): string {
  return line.slice(start1 - 1, start1 - 1 + length);
}

function fieldByName(
  fields: readonly { name: string; start: number; length: number }[],
  name: string,
): { start: number; length: number } {
  const f = fields.find((x) => x.name === name);
  if (!f) throw new Error(`Field ${name} not found`);
  return f;
}

function yyyymmddToDisplay(d: string): string {
  const t = d.trim();
  if (t.length !== 8) return t;
  return `${t.slice(6, 8)}/${t.slice(4, 6)}/${t.slice(0, 4)}`;
}

function yyyymmddToIso(d: string): string {
  const t = d.trim();
  if (t.length !== 8) return t;
  return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
}

/**
 * Appendix 4 §5.4 — post-export completion report from INI.TXT
 * (same export as simulator / open-format files).
 */
export async function buildAppendix54ReportFromIniBuffer(
  iniContent: Buffer,
): Promise<Appendix54Report> {
  const iniText = iconv.decode(iniContent, UNIFORM_STRUCTURE_ENCODING);
  return buildAppendix54ReportFromIniText(iniText);
}

export async function buildAppendix54ReportFromIni(params: {
  iniPath: string;
}): Promise<Appendix54Report> {
  const iniBuf = await readFile(params.iniPath);
  return buildAppendix54ReportFromIniBuffer(iniBuf);
}

function buildAppendix54ReportFromIniText(iniText: string): Appendix54Report {
  const lines = iniText.split(/\r?\n/).filter((l) => l.length > 0);
  const a000Line = lines.find((l) => l.startsWith("A000"));
  if (!a000Line) throw new Error("INI.TXT missing A000 record");

  const counts = new Map<string, number>();
  for (const line of lines) {
    if (line.startsWith("A000")) continue;
    if (line.length < INI_SUMMARY_TOTAL_LENGTH) continue;
    const code = line.slice(0, 4).trim();
    const countStr = line.slice(4, 19).trim();
    const count = Number.parseInt(countStr, 10);
    if (Number.isFinite(count)) counts.set(code, count);
  }

  const recordRows: Appendix54RecordRow[] = APPENDIX_54_RECORD_ROWS.map(
    ({ code, labelHe }) => ({
      code,
      labelHe,
      count: counts.get(code) ?? 0,
    }),
  ).filter((r) => r.count > 0);

  const vn = fieldByName(A000_FIELDS, "vatNumber");
  const bn = fieldByName(A000_FIELDS, "businessName");
  const fp = fieldByName(A000_FIELDS, "filePath");
  const ps = fieldByName(A000_FIELDS, "dataPeriodStart");
  const pe = fieldByName(A000_FIELDS, "dataPeriodEnd");
  const st = fieldByName(A000_FIELDS, "softwareType");
  const sn = fieldByName(A000_FIELDS, "softwareName");
  const rc = fieldByName(A000_FIELDS, "softwareRegistrationCode");
  const pd = fieldByName(A000_FIELDS, "processStartDate");
  const pt = fieldByName(A000_FIELDS, "processStartTime");

  const dateStr = sliceField(a000Line, pd.start, pd.length);
  const timeStr = sliceField(a000Line, pt.start, pt.length);
  const producedAt = new Date(
    `${yyyymmddToIso(dateStr)}T${timeStr.slice(0, 2)}:${timeStr.slice(2, 4)}:00`,
  );

  return {
    taxpayerVat: sliceField(a000Line, vn.start, vn.length).trim(),
    taxpayerName: sliceField(a000Line, bn.start, bn.length).trim(),
    filePath: sliceField(a000Line, fp.start, fp.length).trim(),
    periodStart: sliceField(a000Line, ps.start, ps.length).trim(),
    periodEnd: sliceField(a000Line, pe.start, pe.length).trim(),
    softwareType: sliceField(a000Line, st.start, st.length).trim(),
    softwareName: sliceField(a000Line, sn.start, sn.length).trim(),
    softwareRegistrationCode: sliceField(a000Line, rc.start, rc.length).trim(),
    producedAt,
    recordRows,
  };
}

export function renderAppendix54ReportHtml(report: Appendix54Report): string {
  const fmtProduced = () => {
    const d = report.producedAt;
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yy = String(d.getFullYear()).slice(-2);
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${dd}/${mm}/${yy} ${hh}:${min}`;
  };

  const periodBlock =
    report.softwareType === "1"
      ? `<div>שנת המס שעליה הופקו הנתונים: <strong>${report.periodStart.slice(0, 4)}</strong></div>`
      : `<div>טווח תאריכים: מתאריך <strong>${yyyymmddToDisplay(report.periodStart)}</strong> ועד תאריך <strong>${yyyymmddToDisplay(report.periodEnd)}</strong> (תוכנה רב-שנתית)</div>`;

  const tableRows = report.recordRows
    .map(
      (r) => `
      <tr>
        <td class="code">${escapeHtml(r.code)}</td>
        <td>${escapeHtml(r.labelHe)}</td>
        <td class="num">${r.count.toLocaleString("en-US")}</td>
      </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>הפקת קבצים במבנה אחיד — נספח 4 §5.4</title>
  <style>
    @page { size: A4; margin: 20mm 16mm; }
    body { font-family: Arial, "DejaVu Sans", sans-serif; font-size: 12pt; color: #111; line-height: 1.45; }
    h1 { font-size: 17pt; text-align: center; margin: 0 0 16px; }
    .success { font-weight: bold; margin: 12px 0; color: #0a5; }
    ul.meta { list-style: none; padding: 0; margin: 0 0 16px; }
    ul.meta li { margin: 6px 0; }
    ul.meta strong { font-weight: bold; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; }
    th, td { border: 1px solid #333; padding: 6px 8px; }
    th { background: #eee; text-align: center; }
    td.code, td.num { text-align: center; font-variant-numeric: tabular-nums; }
    .note { font-size: 10pt; color: #444; margin-top: 8px; }
    .footer { margin-top: 24px; font-size: 9pt; text-align: center; border-top: 1px solid #999; padding-top: 8px; }
  </style>
</head>
<body>
  <h1>הפקת קבצים במבנה אחיד</h1>
  <p class="success">ביצוע ממשק פתוח הסתיים בהצלחה.</p>
  <ul class="meta">
    <li>מספר עוסק מורשה: <strong>${escapeHtml(report.taxpayerVat)}</strong></li>
    <li>שם בית העסק: <strong>${escapeHtml(report.taxpayerName)}</strong></li>
    <li>הנתונים נשמרו בנתיב הבא: <strong dir="ltr">${escapeHtml(report.filePath)}</strong></li>
  </ul>
  ${periodBlock}
  <h2 style="font-size: 13pt; margin-top: 18px;">פירוט סך סוגי הרשומות שנוצרו בקובץ BKMVDATA.TXT</h2>
  <table>
    <thead>
      <tr>
        <th>קוד רשומה</th>
        <th>תיאור רשומה</th>
        <th>סך רשומות</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
  </table>
  <p class="note">הערה: שורה מופיעה רק כאשר קיימות רשומות מסוג זה.</p>
  <p>הנתונים הופקו באמצעות תוכנת <strong>${escapeHtml(report.softwareName.trim())}</strong>,
     מספר תעודת הרישום <strong>${escapeHtml(report.softwareRegistrationCode)}</strong>,
     בתאריך <strong>${fmtProduced().split(" ")[0]}</strong>
     בשעה <strong>${fmtProduced().split(" ")[1]}</strong>.</p>
  <div class="footer">InvoLoops · פלט המופק מהתוכנה · נספח 4 (סעיף 5.4)</div>
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
