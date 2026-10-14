# Spec 10 — Uniform Structure Export (מבנה אחיד v1.31)

Archive copy. Authoritative source: `Service_Pages_Income_tax_horaot-131.pdf`
(חוברת הוראות מבנה אחיד גרסה 1.31, 1/5/2009).

## What landed

- **Schema** — `uniform_structure_exports` tracking table +
  `archive_object_kind` gains `UNIFORM_STRUCTURE_INI` +
  `UNIFORM_STRUCTURE_BKMVDATA`.
- **Library** (`src/lib/uniform-structure/`):
  - `types.ts` — `FieldSpec` (with `fieldNumber` cross-ref to the
    spec PDF), v1.31 constants
    (`UNIFORM_STRUCTURE_SYSTEM_CONSTANT="&OF1.31&"`,
    `UNIFORM_STRUCTURE_CHARSET_CODE="1"`,
    `UNIFORM_STRUCTURE_ENCODING="iso-8859-8"`,
    `UNIFORM_STRUCTURE_LANGUAGE_CODE="0"`), and helpers:
    `generatePrimaryId`, `getSoftwareName`, `getSoftwareVersion`,
    `getSoftwareHouseVatNumber`, `getSoftwareHouseName`,
    `getSoftwareRegistrationCode` (N8 per §3.1 — *not* the SHAAM
    API's N9), `getSoftwareType`, `getAccountingMethod`,
    `getCompressionSoftwareName`.
  - `formatters.ts` — `formatText` / `formatNumeric` /
    `formatSignedNumeric` (`+/-` + zero-padded digits, no decimal
    point, e.g. `X9(12)v99`) / `formatDate` (`9(8)`,
    zero-padded when empty per §2.3(e)) / `formatAmount` (unsigned
    `9(N)v99`).
  - `vat-checksum.ts` — Israeli 9-digit checksum.
  - `records/{a000,a100,c100,d110,d120,m100,z900}.ts` — one file
    per record type with a declarative `FIELDS: FieldSpec[]` + a
    thin `serializeXXXX(record)` wrapper. Lengths match v1.31:
    A000=466, A100=95, C100=444, D110=339, D120=222, M100=298,
    Z900=110.
  - `records/ini-summary.ts` — 19-char §3.2 summary line
    (recordCode + 15-digit count). Replaces the previous invented
    `Z000` record type.
  - `records/serializer.ts` — shared formatter dispatch.
  - `build.ts` — loads invoices/customers for the period; generates
    a single 15-digit `primaryId` shared across A000/A100/Z900;
    two-pass builder emits the body (C100 + D110[…] + D120? +
    M100[…]), counts records, then stamps A100 (sequence 1) and
    Z900 (last sequence, with `totalRecords` field 1155 mirroring
    A000 field 1002). INI is A000 + one §3.2 summary line per
    non-zero record-type count. Both files **ISO-8859-8** + CRLF,
    no trailing CRLF.
  - `validate.ts` — local lint for encoding round-trip, line
    endings, record codes, widths, INI A000 + §3.2 summary parsing,
    `&OF1.31&` consistency across A000/A100/Z900, primary-ID
    cross-record agreement, A000 field 1002 ↔ Z900 field 1155
    reconciliation, A100/Z900 boundary, C100→D110 nesting, date
    formats, INI↔BKMVDATA count reconciliation, VAT checksum.
  - `runner.ts` — fire-and-forget orchestrator invoked via
    `setImmediate` from the server action. Uploads INI + BKMVDATA +
    ZIP to MinIO + two `archive_objects` rows for integrity.
- **Server action** (`actions/uniform-structure-actions.ts`):
  - `requestUniformStructureExport(period)` — inserts a PENDING
    row, kicks off the runner, returns `runId`. Re-uses an existing
    PENDING/RUNNING row if present.
  - `getExportStatus`, `listMyUniformStructureExports`,
    `getExportDownloadUrl` — presigned URL returns.
- **Admin UI** at `/admin/uniform-structure` — new-export form +
  past-exports table + download button per DONE row.
- **Verification** — `scripts/verify-uniform-structure.ts` runs 14
  pure scenarios: formatters, formatter error paths, VAT checksum,
  v1.31 record lengths, document-type code mappings, system-constant
  / primaryId placement, validator on clean files, validator on
  truncated records, INI summary count mismatch, A000 ↔ Z900 total
  reconciliation, primaryId cross-record mismatch, trailing-CRLF
  detection, signed negative formatting, primaryId generator. All
  14/14 pass.

## How to operate

1. Apply `drizzle/0031_uniform_structure_exports.sql`.
2. Open `/admin/uniform-structure`, pick a period (≤2 years), click
   Generate export. The runner uploads INI.TXT, BKMVDATA.TXT, and a
   convenience ZIP; the table updates from RUNNING → DONE.
3. Download the ZIP, extract the two files.
4. Upload INI.TXT + BKMVDATA.TXT to the ITA simulator.
5. On error: simulator reports a field-position/length mismatch.
   Update the corresponding `FieldSpec` in
   `src/lib/uniform-structure/records/*.ts`, regenerate, re-upload.
6. When the simulator returns a clean pass, capture the screenshot
   for Form 513 (Spec 12).

## v1.31 alignment — full rewrite (4/2026)

After receiving `Service_Pages_Income_tax_horaot-131.pdf` (the
authoritative חוברת הוראות מבנה אחיד), the prior best-effort
reconstruction was replaced with a near-total rewrite:

- **Encoding** flipped from Windows-1255 → **ISO-8859-8** (charset
  code "1" per A000 field 1029). All file I/O uses `iconv-lite`
  with that codec.
- **Primary ID** — single 15-digit random number generated per
  export, stamped into A000 field 1004, A100 field 1103, and Z900
  field 1153. Validator enforces equality across all three.
- **System constant** `&OF1.31&` written into A000 field 1005,
  A100 field 1104, Z900 field 1154. Validator enforces.
- **A000** rebuilt to 466 chars (§3.1) — added business address
  (street/house/city/zip), company registration number,
  withholding file number, language code, charset, compression
  software name, leading currency, branch info. `processStartTime`
  is HHMM (4 chars), not HHMMSS. `softwareRegistrationCode` is
  N8 per §3.1 — distinct from the SHAAM API's N9
  (`accounting_software_number`); the two paths stay separate.
- **A100** simplified to 95 chars (§4.1) — drops the invented
  `totalRecordsInFile`/`fileSequence` fields; just sequence + VAT
  + primary-ID + `&OF1.31&`.
- **Z900** rebuilt to 110 chars (§4.2) — adds `totalRecords`
  (field 1155) which **must** equal A000 field 1002. Validator
  cross-checks.
- **C100** rebuilt to 444 chars (§4.3) — customer address split
  into street/house/city/zip/country/country-code. All amount
  fields are `signedNumeric` (`X9(12)v99`). Document-type code
  fixed: `DELIVERY_NOTE`=200 (was 710),
  `PROFORMA`=300 (was 332). 332 stays in `src/lib/shaam/payload.ts`
  because the SHAAM REST API and the Uniform Structure file are
  separate paths.
- **D110** rebuilt to 339 chars (§4.4) — added base-document type
  / number / branchId, transaction type, manufacturer name,
  product serial number. `quantity` is signed `X9(12)v9999`
  (4 implicit decimals). `vatRate` is `9(2)v99` (4 chars; e.g.
  `1700` for 17.00%).
- **D120** rebuilt to 222 chars (§4.5) — full payment detail:
  bank/branch/account/cheque numbers, clearing-company code,
  card name, credit-transaction type. Payment method is 1 digit
  per §4.5: 1=cash, 2=cheque, 3=card, 4=bank-transfer, 5=voucher,
  6=replacement, 7=promissory, 8=standing-order, 9=other.
- **M100** rebuilt to 298 chars (§4.8) — added universal SKU,
  supplier SKU, sort code, sort description, cost price (bonded
  / non-bonded).
- **INI summaries** — replaced the invented `Z000` record with
  v1.31 §3.2 summary lines: 4-char record code + 15-digit count,
  one per non-zero BKMVDATA record type. A000 itself is **not**
  emitted as a summary line — it's the INI header.

### Sign convention (§2.4(יב))

- C100 / D110 amounts default to `+`. Only fields whose meaning
  *reduces* the document amount carry `-` (e.g. C100 field 1220
  document discount, D110 field 1266 line discount).
- Credit-invoice / credit-note semantics travel via `documentType`
  (CREDIT_INVOICE → 330), **not** via negative line totals.

### Date / time (§2.3(d))

- Date fields are `9(8)` `YYYYMMDD`. Empty + optional → 8 zeros
  (per §2.3(e), not 8 spaces).
- Time fields are `9(4)` `HHMM` (A000 field 1027, C100 field 1206).

## Known limitations

- Synthetic SKUs + synthetic D120 cash payment when an invoice has
  no payments array. M100 records are emitted with zero balances /
  zero traffic (we don't track real inventory).
- Customer address mapping uses the single `customers.address`
  string for `customerStreet`; remaining address fields stay empty
  until we decompose addresses in the schema.
- ZIP packaging + final on-disk directory layout
  (`OPENFRMT/<vat>.<yy>/<file>`) is still TBD; current export
  ships INI.TXT + BKMVDATA.TXT inside a flat ZIP.
- `setImmediate` runner — queue infra is a post-launch hardening
  item.

## Verification

```bash
npx tsx scripts/verify-uniform-structure.ts
```

Currently 14/14 pure scenarios pass without DATABASE_URL. The
DB-backed end-to-end build path is exercised separately by
`/admin/uniform-structure` against a seeded business + invoices.
