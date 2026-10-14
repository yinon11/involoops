import iconv from "iconv-lite";
import { DETAILED_FIELDS, SHORT_FIELDS, fieldMap } from "./fields";
import { parseMoveinPrm, type ParsedMoveinPrm } from "./prm";
import {
  MOVEIN_DETAILED_RECORD_LENGTH,
  MOVEIN_ENCODING,
  MOVEIN_SHORT_RECORD_LENGTH,
  type MoveinMethod,
} from "./types";

export interface MoveinRecord {
  recordNumber: number;
  isHeader: boolean;
  raw: string;
  fields: Record<string, string>;
}

export interface ParsedMoveinFile {
  method: MoveinMethod;
  recordLength: number;
  records: MoveinRecord[];
  prm?: ParsedMoveinPrm;
}

const CRLF = "\r\n";

export function decodeMoveinBuffer(buf: Buffer): string {
  return iconv.decode(buf, MOVEIN_ENCODING);
}

export function encodeMoveinText(text: string): Buffer {
  return iconv.encode(text, MOVEIN_ENCODING);
}

/** Split on CRLF while keeping each line's terminator in the byte length check path. */
export function splitMoveinRecords(buf: Buffer, recordLength: number): Buffer[] {
  const records: Buffer[] = [];
  let offset = 0;
  while (offset < buf.length) {
    const chunk = buf.subarray(offset, offset + recordLength);
    if (chunk.length === 0) break;
    records.push(chunk);
    offset += recordLength;
  }
  return records;
}

export function bufferRecordToText(recordBuf: Buffer): string {
  return iconv.decode(recordBuf, MOVEIN_ENCODING);
}

export function detectMoveinMethod(
  buf: Buffer,
  prm?: ParsedMoveinPrm,
): MoveinMethod {
  if (prm) return "flexible";
  const firstLen = firstRecordLength(buf);
  if (firstLen === MOVEIN_DETAILED_RECORD_LENGTH) return "detailed";
  if (firstLen === MOVEIN_SHORT_RECORD_LENGTH) return "short";
  throw new Error(
    `Cannot detect MOVEIN method from record length ${firstLen}; pass --prm for flexible imports`,
  );
}

function firstRecordLength(buf: Buffer): number {
  const crlf = buf.indexOf("\r\n");
  if (crlf === -1) {
    throw new Error("MOVEIN data has no CRLF line ending");
  }
  return crlf + 2;
}

export function parseHeaderCount(headerFields: Record<string, string>): number | null {
  const raw = (headerFields.movementType ?? headerFields.reference1 ?? "").trim();
  if (!raw || raw === "0") return null;
  const n = Number(raw.replace(/\s/g, ""));
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export function parseMoveinFile(params: {
  data: Buffer;
  prmText?: string;
  method?: MoveinMethod;
}): ParsedMoveinFile {
  const prm = params.prmText ? parseMoveinPrm(params.prmText) : undefined;
  const method =
    params.method ?? (prm ? "flexible" : detectMoveinMethod(params.data, prm));

  const recordLength =
    method === "detailed"
      ? MOVEIN_DETAILED_RECORD_LENGTH
      : method === "short"
        ? MOVEIN_SHORT_RECORD_LENGTH
        : prm!.recordLength;

  const fieldSpecs =
    method === "detailed"
      ? DETAILED_FIELDS
      : method === "short"
        ? SHORT_FIELDS
        : prm!.fields;

  const chunks = splitMoveinRecords(params.data, recordLength);
  const records: MoveinRecord[] = chunks.map((chunk, idx) => {
    const raw = bufferRecordToText(chunk);
    return {
      recordNumber: idx + 1,
      isHeader: idx === 0,
      raw,
      fields: fieldMap(raw, fieldSpecs),
    };
  });

  return { method, recordLength, records, prm };
}

export function parseMoveinAmount(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  if (trimmed.includes(".")) {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : 0;
  }
  const digits = trimmed.replace(/\s/g, "");
  if (!/^\d+$/.test(digits)) return 0;
  // Hashavshevet 12-char decimal fields commonly use 2 implied decimals.
  return Number(digits) / 100;
}

export function isValidDdMmYy(raw: string): boolean {
  const t = raw.trim();
  if (!t) return true;
  if (!/^\d{6}$/.test(t)) return false;
  const dd = Number(t.slice(0, 2));
  const mm = Number(t.slice(2, 4));
  const yy = Number(t.slice(4, 6));
  return dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12 && yy >= 0 && yy <= 99;
}

export function hasNonEmptyAccount(...accounts: string[]): boolean {
  return accounts.some((a) => a.trim().length > 0);
}

export function recordTerminatorOk(raw: string): boolean {
  return raw.endsWith(CRLF);
}
