# TTP Invoice Dashboard — Technical Implementation Plan

## Overview

A **multi-tenant** invoice management application where each user has an isolated workspace with a private dashboard. Users upload invoice documents (PDF), the system auto-extracts structured data (date, vendor, amount, currency, VAT, invoice number), and presents everything in a polished dashboard with charts, filters, and export capabilities.

**Architecture decision: Next.js (single repo, no separate backend).** Next.js provides API routes, Server Actions, SSR, and auth integration — sufficient for this scale (~300 invoices, ~37 vendors per user). A separate backend would only be needed for heavy async workers, which can be added later.

---

## 1. Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| **Framework** | Next.js 15+ (App Router) | Server Components, Server Actions, API routes in one repo |
| **Language** | TypeScript 5 (strict mode) | Type safety across DB schema, API, and UI |
| **Auth** | Auth.js v5 (next-auth) | Middleware protection, multi-tenant via session `userId`. Providers: credentials (email/password with bcrypt) + Google OAuth |
| **Database** | PostgreSQL (via Neon or Supabase hosted) | Relational model fits invoices, vendors, periods. Full-text search for Hebrew |
| **ORM** | Drizzle ORM + drizzle-kit | TypeScript-first, lightweight, excellent migration tooling, Zod schema generation via `drizzle-zod` |
| **File Storage** | Cloudflare R2 (S3-compatible) | Cheap egress, presigned URL uploads, no vendor lock-in. Alternative: AWS S3 or local disk for dev |
| **PDF Text Extraction** | `unpdf` (primary) | Modern, edge-compatible wrapper around pdf.js. Falls back to `pdfjs-dist` for positional text |
| **Vision Fallback** | Claude API (claude-sonnet) via `@anthropic-ai/sdk` | For scanned/image PDFs where text extraction yields nothing. Structured output extraction |
| **Validation** | Zod | Schema validation for all Server Actions, API inputs, and extracted invoice data |
| **UI Components** | shadcn/ui (Radix UI + Tailwind CSS v4) | Vendored components: Button, Dialog, Table, Select, Tabs, Card, Badge, Calendar, DateRangePicker, etc. |
| **Data Table** | TanStack Table v8 + shadcn Table | Sorting, filtering, pagination, column visibility |
| **Charts** | Recharts | Line chart for monthly trend, PieChart/DonutChart for vendor breakdown |
| **Forms** | React Hook Form + Zod resolver | Type-safe form handling with validation |
| **Date Handling** | `date-fns` with `date-fns/locale/he` | Hebrew locale support, lightweight, tree-shakeable |
| **Export** | `xlsx` (SheetJS) for Excel, `jszip` for ZIP bundling | Client-side or server-side export of filtered invoice data + original PDFs |
| **Email (optional)** | Resend | Approval notifications, daily digests |
| **Dev Tools** | ESLint, Prettier, `dotenv`, `tsx` for scripts | Standard DX |

---

## 2. Project Structure

```
invoices/
├── drizzle.config.ts
├── next.config.ts
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── .env.local                          # DB URL, R2 keys, AUTH_SECRET, ANTHROPIC_API_KEY
├── .env.example
├── src/
│   ├── app/
│   │   ├── layout.tsx                  # Root layout: font, theme, SessionProvider
│   │   ├── page.tsx                    # Landing / redirect to dashboard
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx
│   │   │   ├── register/page.tsx
│   │   │   └── layout.tsx              # Centered auth layout
│   │   ├── (app)/                      # Authenticated group
│   │   │   ├── layout.tsx              # Sidebar/header, gradient nav bar
│   │   │   ├── dashboard/
│   │   │   │   └── page.tsx            # Main dashboard: stats, charts, table
│   │   │   ├── invoices/
│   │   │   │   ├── page.tsx            # Invoice list with filters
│   │   │   │   ├── [id]/page.tsx       # Invoice detail / edit
│   │   │   │   └── upload/page.tsx     # Upload + parsing UI
│   │   │   ├── pending/
│   │   │   │   └── page.tsx            # Pending approval queue
│   │   │   ├── review/
│   │   │   │   └── page.tsx            # Needs manual review
│   │   │   ├── vendors/
│   │   │   │   ├── page.tsx            # Vendor list + tracking
│   │   │   │   └── [id]/page.tsx       # Vendor detail + custom rules editor
│   │   │   ├── settings/
│   │   │   │   └── page.tsx            # Period locking, account settings
│   │   │   └── export/
│   │   │       └── route.ts            # Export API (ZIP download)
│   │   └── api/
│   │       ├── auth/[...nextauth]/route.ts
│   │       ├── upload/
│   │       │   ├── presign/route.ts    # Generate presigned URL for R2
│   │       │   └── process/route.ts    # Trigger extraction pipeline
│   │       └── invoices/
│   │           └── duplicate-check/route.ts
│   ├── auth.ts                         # Auth.js v5 config
│   ├── middleware.ts                   # Route protection
│   ├── db/
│   │   ├── index.ts                    # Drizzle client singleton
│   │   ├── schema/
│   │   │   ├── users.ts
│   │   │   ├── invoices.ts
│   │   │   ├── vendors.ts
│   │   │   ├── extraction-rules.ts
│   │   │   ├── periods.ts
│   │   │   └── index.ts               # Re-exports all schemas
│   │   └── migrations/                 # Generated by drizzle-kit
│   ├── lib/
│   │   ├── extraction/
│   │   │   ├── pipeline.ts             # Orchestrator: text extract -> parse -> validate
│   │   │   ├── text-extractor.ts       # unpdf/pdfjs text extraction
│   │   │   ├── vision-extractor.ts     # Claude vision fallback
│   │   │   ├── field-parser.ts         # General regex/heuristic extraction
│   │   │   ├── hebrew-parser.ts        # Hebrew date formats, RTL normalization
│   │   │   ├── vendor-matcher.ts       # Match extracted text to known vendors
│   │   │   └── vendor-rules/
│   │   │       ├── index.ts            # Registry of vendor-specific extractors
│   │   │       ├── types.ts            # VendorRule interface
│   │   │       └── rules/              # Individual vendor rule files
│   │   ├── duplicate-detector.ts       # Hash + fuzzy matching
│   │   ├── currency.ts                 # ILS/USD formatting, conversion helpers
│   │   ├── storage.ts                  # R2/S3 client, presigned URL generation
│   │   ├── export.ts                   # XLSX + ZIP generation
│   │   ├── validators.ts              # Zod schemas for invoice data
│   │   └── utils.ts                    # General utilities
│   ├── components/
│   │   ├── ui/                         # shadcn/ui vendored components
│   │   ├── dashboard/
│   │   │   ├── stat-cards.tsx          # Total spent, monthly avg, burn rate, vendor count
│   │   │   ├── monthly-trend-chart.tsx # Recharts LineChart
│   │   │   ├── vendor-donut-chart.tsx  # Recharts PieChart
│   │   │   └── dashboard-filters.tsx   # Year dropdown, month buttons, date range
│   │   ├── invoices/
│   │   │   ├── invoice-table.tsx       # TanStack Table with columns
│   │   │   ├── invoice-columns.tsx     # Column definitions
│   │   │   ├── invoice-filters.tsx     # Vendor multi-select, month, date range
│   │   │   ├── invoice-form.tsx        # Manual edit / create form
│   │   │   ├── upload-dropzone.tsx     # Drag & drop PDF upload
│   │   │   └── vat-toggle.tsx          # Show with/without VAT
│   │   ├── vendors/
│   │   │   ├── vendor-table.tsx
│   │   │   └── rule-editor.tsx         # JSON/form editor for vendor extraction rules
│   │   ├── approval/
│   │   │   ├── approval-queue.tsx
│   │   │   └── review-card.tsx         # Side-by-side: PDF preview + extracted data
│   │   └── shared/
│   │       ├── header.tsx              # Purple/blue gradient header
│   │       ├── sidebar.tsx
│   │       ├── currency-display.tsx
│   │       └── period-lock-badge.tsx
│   ├── hooks/
│   │   ├── use-invoices.ts
│   │   ├── use-vendors.ts
│   │   └── use-dashboard-stats.ts
│   ├── actions/                        # Server Actions
│   │   ├── invoice-actions.ts          # CRUD, approve, reject
│   │   ├── vendor-actions.ts           # CRUD, update rules
│   │   ├── upload-actions.ts           # Process upload
│   │   ├── period-actions.ts           # Lock/unlock periods
│   │   └── export-actions.ts
│   └── types/
│       ├── invoice.ts
│       ├── vendor.ts
│       └── extraction.ts
└── public/
```

---

## 3. Data Model

All tables include `userId` (FK → users) for multi-tenant isolation. Every query filters by the authenticated user's ID.

### users

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| email | varchar(255) unique | |
| name | varchar(255) | |
| passwordHash | varchar(255) | nullable (for OAuth users) |
| createdAt | timestamp | |

### vendors

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| userId | uuid FK → users | |
| name | varchar(255) | Display name |
| aliases | text[] | Alternative names found in PDFs |
| defaultCategory | varchar(100) | e.g., "SaaS", "Office", "Travel" |
| createdAt | timestamp | |
| unique(userId, name) | | |

### extraction_rules

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| userId | uuid FK → users | |
| vendorId | uuid FK → vendors | nullable (null = general rule) |
| priority | integer | Higher = checked first |
| name | varchar(255) | Human label |
| rules | jsonb | `{ datePatterns, amountPatterns, invoiceNumberPattern, vatPattern, ... }` |
| isActive | boolean | |
| createdAt / updatedAt | timestamp | |

### invoices

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| userId | uuid FK → users | |
| vendorId | uuid FK → vendors | nullable until matched |
| type | enum('expense','income') | |
| status | enum('processing','pending','approved','rejected') | |
| invoiceNumber | varchar(255) | |
| invoiceDate | date | |
| amount | decimal(12,2) | Total including VAT |
| currency | varchar(3) | 'ILS', 'USD', etc. |
| vatAmount | decimal(12,2) | |
| amountWithoutVat | decimal(12,2) | Computed or stored |
| description | text | |
| fileUrl | varchar(1024) | R2 URL |
| fileHash | varchar(64) | SHA-256 for duplicate detection |
| extractedText | text | Raw text from PDF |
| extractionMethod | enum('text','vision','manual') | |
| extractionConfidence | decimal(3,2) | 0.00–1.00 |
| needsReview | boolean | default false |
| reviewNotes | text | Why flagged |
| periodLocked | boolean | Denormalized for query speed |
| createdAt / updatedAt | timestamp | |
| unique(userId, fileHash) | | Duplicate prevention |

### periods

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| userId | uuid FK → users | |
| year | integer | |
| month | integer | 1–12 |
| isLocked | boolean | |
| lockedAt | timestamp | |
| unique(userId, year, month) | | |

### audit_log (optional, recommended)

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| userId | uuid FK | |
| invoiceId | uuid FK | |
| action | varchar(50) | 'approved', 'rejected', 'edited', 'locked' |
| details | jsonb | |
| createdAt | timestamp | |

---

## 4. Extraction Pipeline Architecture

This is the core of the application. The pipeline is a multi-stage process:

```
Upload PDF
    │
    ▼
[1] Text Extraction (unpdf)
    │
    ├─ Text extracted successfully (>50 chars of meaningful content)
    │       │
    │       ▼
    │   [2] Vendor Matching
    │       │
    │       ├─ Known vendor matched (via name/aliases in extracted text)
    │       │       │
    │       │       ▼
    │       │   [3a] Vendor-Specific Extractor
    │       │       │
    │       │       ▼
    │       │   [4] Validation (Zod: date, amount, currency all present?)
    │       │       │
    │       │       ├─ Valid → status=pending, confidence=high
    │       │       └─ Invalid → [3b] General Extractor fallback
    │       │
    │       └─ No vendor matched
    │               │
    │               ▼
    │           [3b] General Extractor (regex/heuristic)
    │               │
    │               ▼
    │           [4] Validation
    │               │
    │               ├─ Valid → status=pending, confidence=medium
    │               └─ Partially valid → needsReview=true, status=pending
    │
    └─ Text extraction failed / insufficient text
            │
            ▼
        [5] Vision Fallback (Claude API)
            │  Send PDF page images with structured extraction prompt
            │
            ▼
        [4] Validation
            │
            ├─ Valid → status=pending, confidence=medium, method=vision
            └─ Invalid → needsReview=true, status=pending
```

### 4a. Text Extractor (`text-extractor.ts`)

- Uses `unpdf` to extract raw text from all pages
- Joins pages with delimiters, returns raw string + metadata (page count, has-images flag)
- Quality check: character count > 50, not just whitespace/garbage, contains alphanumeric or Hebrew characters (U+0590–U+05FF)

### 4b. Hebrew Parser (`hebrew-parser.ts`)

Hebrew dates appear in many formats. The parser handles:

- **Standard numeric**: `DD/MM/YYYY`, `DD.MM.YYYY`, `DD-MM-YYYY` (Israeli standard is DD/MM, never MM/DD)
- **Hebrew month names**: `1 בינואר 2026` — mapping: ינואר→1, פברואר→2, מרץ→3, אפריל→4, מאי→5, יוני→6, יולי→7, אוגוסט→8, ספטמבר→9, אוקטובר→10, נובמבר→11, דצמבר→12
- **RTL normalization**: When pdf.js extracts Hebrew, character order may be reversed. Detect by checking if Hebrew Unicode block characters appear reversed relative to numbers, and flip accordingly
- **Critical rule**: Israeli invoices use DD/MM/YYYY, never MM/DD/YYYY. Vendor rules can override if a vendor uses US format

### 4c. General Field Parser (`field-parser.ts`)

- **Amount**: Look for `סה"כ` (total), `סכום`, `total`, `amount` near currency symbols/numbers. Regex: currency symbol/code + number with commas/decimals. Handles `₪`, `ILS`, `$`, `USD`
- **VAT**: Look for `מע"מ` (Hebrew VAT), `VAT`, `tax` near a number/percentage. If 17%/18% of total matches a nearby number, confirms VAT
- **Invoice Number**: Look for `חשבונית מס` (tax invoice), `invoice #`, `מספר` near number sequences
- **Date**: Delegates to `hebrew-parser.ts`
- **Vendor name**: Extract from header area (first 20% of text), look for business name patterns

### 4d. Vendor-Specific Rules

Rules stored in DB as JSONB, not hardcoded:

```typescript
interface VendorRule {
  vendorId: string;
  identifiers: string[];        // strings that identify this vendor in PDF text
  dateSelector: {
    pattern: string;            // regex
    group: number;              // capture group
    format: string;             // date-fns format string
  };
  amountSelector: {
    pattern: string;
    group: number;
    multiplier?: number;        // e.g., -1 for credits
  };
  vatSelector: { pattern: string; group: number; };
  invoiceNumberSelector: { pattern: string; group: number; };
  currencyOverride?: string;    // if vendor always bills in one currency
}
```

The UI lets users: (1) view extracted text from a sample invoice, (2) create regex patterns, (3) test against past invoices, (4) save/update.

### 4e. Vision Fallback (`vision-extractor.ts`)

- Converts PDF pages to PNG images (via pdfjs-dist canvas rendering)
- Sends to Claude API with structured prompt requesting JSON: `invoiceDate`, `vendorName`, `amount`, `currency`, `vatAmount`, `invoiceNumber`, `description`
- Prompt explicitly instructs about Hebrew date formats and Israeli invoice conventions
- Rate-limited, only used when text extraction fails

### 4f. Duplicate Detection

- **Level 1 (exact)**: SHA-256 hash of uploaded file. If hash exists for this user, reject immediately
- **Level 2 (semantic)**: After extraction, check for same vendor + invoice number + date + amount. Flag as potential duplicate with `needsReview=true`

### 4g. Confidence Scoring

| Score | Meaning |
|-------|---------|
| 0.9+ | Vendor-specific rule matched, all fields found |
| 0.7–0.9 | General extraction, all fields found |
| 0.5–0.7 | Partial extraction or vision fallback |
| < 0.5 | Auto-flags `needsReview=true` |

---

## 5. Key Architectural Decisions

### Multi-tenancy via userId column (not separate databases)
At ~300 invoices and ~37 vendors per user, row-level isolation with `userId` filter is sufficient. A Drizzle helper `withUser(userId)` wraps all queries to prevent data leaks.

### Server Actions over API routes for mutations
Server Actions provide type safety end-to-end, automatic revalidation, and progressive enhancement. API routes reserved for: presigned URL generation, export file streaming, and extraction trigger.

### Extraction rules in the database, not code
Vendor-specific rules live in `extraction_rules` as JSONB. Users can create and refine rules through the UI without code changes. The `vendor-rules/rules/` directory has seed/example rules only.

### VAT calculation
Israeli VAT is currently 18%. Store `amount` (total incl. VAT), `vatAmount`, and `amountWithoutVat`. If only total extracted: `vatAmount = amount - (amount / 1.18)`. The "show without VAT" toggle uses `amountWithoutVat`.

---

## 6. Implementation Phases

### Phase 1: Foundation
- Initialize Next.js with TypeScript, Tailwind CSS v4, ESLint
- Install and configure shadcn/ui (core components)
- Set up Drizzle ORM with PostgreSQL, create all schema files, run initial migration
- Set up Auth.js v5 with credentials + Google OAuth
- Create login/register pages, middleware for route protection
- Create `(auth)` and `(app)` route group layouts

### Phase 2: File Storage + Basic Upload
- Set up R2/S3 client in `lib/storage.ts`
- Build presigned URL API route
- Build `upload-dropzone.tsx` with drag-and-drop, progress indicator, multi-file support
- Store uploaded file reference in `invoices` table with `status=processing`

### Phase 3: Extraction Pipeline
- Implement `text-extractor.ts` with `unpdf`
- Implement `hebrew-parser.ts` with all date format patterns
- Implement `field-parser.ts` with general extraction heuristics
- Implement `vendor-matcher.ts` — match extracted text against known vendor names/aliases
- Implement `vision-extractor.ts` with Claude API fallback
- Implement `pipeline.ts` orchestrator
- Implement `duplicate-detector.ts`
- Build processing API route that runs pipeline after upload
- Write tests for the Hebrew date parser (most fragile component)

### Phase 4: Approval Workflow
- Build pending approval queue page with side-by-side view (PDF viewer + extracted fields)
- Implement approve/reject Server Actions with period lock checking
- Build "needs review" page filtered to `needsReview=true`
- Implement inline editing of extracted fields before approval
- Build invoice detail page for viewing/editing

### Phase 5: Dashboard + Charts
- Build stat cards: total spent, monthly average, 30-day burn rate, vendor count
- Build monthly spending trend line chart (Recharts LineChart)
- Build spending by vendor donut chart (Recharts PieChart with inner radius)
- Build filter bar: vendor multi-select, month quick-select buttons, year dropdown, date range picker
- Implement "show amounts without VAT" toggle
- Wire all filters to query params (shareable/bookmarkable)

### Phase 6: Invoice Table + Vendor Management
- Build full invoice table with TanStack Table: sortable columns, pagination, column visibility
- Build vendor list page with invoice counts, total spend per vendor
- Build vendor detail page with extraction rule editor
- Implement vendor-specific rule CRUD (create, test, activate)

### Phase 7: Period Locking + Export
- Build settings page with period locking UI (month/year grid with lock toggles)
- Enforce period locks in Server Actions
- Build export: filtered data to XLSX, "Download ZIP" bundles XLSX + original PDFs
- Build export API route with streaming response

### Phase 8: Polish + Edge Cases
- Income vs. expense distinction in UI (tab/toggle, different chart colors)
- Currency handling: `₪` for ILS, `$` for USD
- RTL layout testing and fixes for Hebrew vendor names
- Error handling: extraction failures surface clearly, retry for vision
- Loading states with Suspense boundaries and skeleton components
- Mobile responsiveness
- Purple/blue gradient header styling, final visual polish to match design

---

## 7. Risks and Mitigations

| Challenge | Mitigation |
|-----------|------------|
| Hebrew text from PDFs produces reversed/garbled text | `hebrew-parser.ts` includes reversal-detection heuristic. Test with real Israeli invoices early. If `unpdf` fails, try `pdfjs-dist` directly |
| Scanned PDFs (images, not text) | Pipeline auto-detects low text yield and falls back to Claude vision. Budget for API costs |
| Date ambiguity (01/02/2026) | Default DD/MM/YYYY for Israeli invoices. Vendor rules can override to MM/DD/YYYY |
| Large PDF uploads blocking requests | Upload goes directly to R2 via presigned URL. Extraction runs async — client polls or uses SSE |
| Period lock race conditions | Database transaction: check lock + update invoice atomically |
