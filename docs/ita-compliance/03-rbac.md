# Spec 03 — Role-Based Access Control (RBAC)

> **Context:** Read `AGENTS.md` at the repo root first. Read specs `01-document-numbering.md` and `02-audit-log.md` — this spec assumes numbering and audit log are in place.
>
> **Access control:** All outbound invoicing features remain gated to platform admins (`isUserAdmin(session.user.id)`) at the nav/route level. This spec adds a finer-grained permission model *within* a tenant that does not replace admin gating — it prepares for the eventual multi-user tenant rollout.

## Decisions (captured before implementation)

- **Audit log migration:** truncate `document_audit_log` and reseed. Do not migrate existing hash chains. Any existing audit entries are dev-test data only. Acceptable because no paying customer has received tax invoices from InvoLoops at the time of this migration. Future migrations after launch must preserve chains.
- **`usesOutboundInvoicing` flag:** skip. Create a `business_entities` row for every user. Keeps the model uniform; if a user never issues invoices, their row stays with nullable Osek Murshe and nobody cares.

## Goal

Introduce a tenant-scoped role model for outbound invoicing so that when InvoLoops eventually opens the feature to tenants beyond platform admins, there is already a clear authorization layer distinguishing who within a business can:

- Create drafts
- Issue final documents (moving from draft → sent)
- Void documents (issue credit notes)
- View the audit log
- Export data (Uniform Structure, audit log, etc.)

Today, all of these actions continue to be restricted to platform admins. The role model is built but enforced through a single admin-level short-circuit until the tenant UI rollout.

## Background

Israeli bookkeeping rules do not mandate a specific RBAC model, but they do require that the software supports segregation of duties — for example, the user who voids invoices should not necessarily be the same user who creates them, and the software must support this distinction. The Form 513 review frequently asks how the software handles user roles.

Building this now — even if it's latent — means Form 513 gets a clean "yes, segregation is supported" answer, and future tenant rollout doesn't require a schema migration.

## Required changes

### 1. Drizzle schema

`business_entities` — legal "עוסק" within InvoLoops. Currently 1:1 with a user, modeled separately so future multi-user-per-business rollout doesn't require migration. Columns include `ownerUserId` (unique FK to users), `legalName`, `legalNameEn`, `osekMurshe` (the 9-digit identifier on every invoice — labeled per `entityType` as Osek Murshe / ח.פ. / ע.ר. / partnership number), `entityType` enum (`OSEK_MURSHE | OSEK_PATUR | CHEVRA_BAAM | AMUTA | SHUTAFUT`), `address` jsonb, `phone`, `email`, `taxYearStartsMonth` (smallint default 1).

`business_entity_members` — role assignment of a user to a business entity. Columns: `businessEntityId`, `userId`, `role` enum (`OWNER | ACCOUNTANT | ISSUER | VIEWER | AUDITOR`), `permissions` jsonb, with `UNIQUE(businessEntityId, userId)`.

`rbac_denials` — lightweight denial log. Columns: `userId`, `businessEntityId` (nullable), `permission`, `reason`, `route`, `createdAt`. Indexed on `(userId, createdAt DESC)`.

### 2. Link existing tables

Add `businessEntityId NOT NULL` to `outbound_invoices`, `document_number_sequences`, `document_audit_log`.

Change the unique on `document_number_sequences` from `(userId, documentType, taxYear)` to `(businessEntityId, documentType, taxYear)`. `userId` is kept as a denormalised convenience column.

Change the unique on `document_audit_log` from `(userId, sequenceNumber)` to `(businessEntityId, sequenceNumber)`. Hash chain scope becomes per business entity. Canonical JSON input switches from `userId` to `businessEntityId`. Because the truncate-and-reseed path was chosen, no existing entries need to be rehashed.

### 3. Permission model

`src/lib/rbac/permissions.ts`:

```
DOCUMENT_CREATE_DRAFT = 'document:create_draft'
DOCUMENT_ISSUE       = 'document:issue'       // draft → sent (signs + SHAAM)
DOCUMENT_VOID        = 'document:void'        // credit-note flow
DOCUMENT_VIEW        = 'document:view'
AUDIT_VIEW           = 'audit:view'
AUDIT_EXPORT         = 'audit:export'
EXPORT_UNIFORM_STRUCTURE = 'export:uniform_structure'
BUSINESS_ENTITY_EDIT = 'business_entity:edit'
MEMBERS_MANAGE       = 'members:manage'
```

Role presets:
- `OWNER` — all
- `ACCOUNTANT` — draft, issue, void, view, audit_view, audit_export, export_uniform
- `ISSUER` — draft, issue, view
- `VIEWER` — view
- `AUDITOR` — view, audit_view, audit_export, export_uniform

Role-to-permission mapping is the default; stored `permissions` JSON on the membership row is authoritative at runtime.

### 4. Authorization helper

`src/lib/rbac/authorize.ts`:

```
authorize({ userId, businessEntityId, permission, route? })
  -> { allowed: true } | { allowed: false, reason }

requirePermission(params)  -> throws if denied
```

1. Platform admin short-circuit: if `isUserAdmin(userId)`, allowed.
2. Else look up membership; absent → `not_a_member`.
3. Else check membership's `permissions` array.
4. Denials write to `rbac_denials` (not the audit chain).

### 5. Wire authorization into server actions

Every outbound/audit server action calls `requirePermission`:
- `createOutboundInvoice` → `DOCUMENT_CREATE_DRAFT`
- `updateOutboundInvoiceDraft` → `DOCUMENT_CREATE_DRAFT`
- `updateOutboundInvoiceStatus` → `DOCUMENT_CREATE_DRAFT` (draft status stays; future `issueOutboundInvoice` will be `DOCUMENT_ISSUE`)
- `deleteOutboundInvoice` (soft-delete of drafts) → `DOCUMENT_CREATE_DRAFT`
- list/getById → `DOCUMENT_VIEW`
- list/export audit → `AUDIT_VIEW` / `AUDIT_EXPORT`

### 6. Business entity context resolution

`src/lib/rbac/current-business-entity.ts`:

```
getCurrentBusinessEntity()  -> BusinessEntity  (throws if none)
```

Queries `business_entities` where `ownerUserId = session.user.id`. Memoised per request via React `cache()`.

### 7. Settings UI

`/settings/business-entity`:
- Admin-only for now.
- Form for legal name (he + en), Osek Murshe (9 digits if provided), company registration, entity type, address, phone, email, fiscal year start month.
- Validation on Osek Murshe format.
- Link from `/settings`.

### 8. Denials log

Write-only from `authorize`. No UI yet.

### 9. i18n

Roles, entity types, denial messages, business-entity field labels in `en` and `he`.

## Tests

`scripts/verify-rbac.ts`:
1. Admin short-circuit — admin with no membership row → allowed.
2. Non-member denial — non-admin, no membership → `not_a_member`.
3. Owner permissions — non-admin `OWNER` → all allowed.
4. Partial permissions — non-admin `VIEWER` → `DOCUMENT_VIEW` allowed, `DOCUMENT_CREATE_DRAFT` denied.
5. Denial logging — denial inserts a `rbac_denials` row.
6. Business entity context — `getCurrentBusinessEntity` returns the owned entity.
7. Cross-tenant isolation — caller B operating on business A's resource is denied.

The verification scripts from specs 01 and 02 are updated to create a business entity per disposable user and thread `businessEntityId` through the sequence + audit flows.

## Done criteria

- [ ] `business_entities`, `business_entity_members`, `rbac_denials` tables exist.
- [ ] Every existing user has a seeded business entity + OWNER membership with full permissions.
- [ ] `outbound_invoices`, `document_number_sequences`, `document_audit_log` carry `businessEntityId`.
- [ ] All server actions call `requirePermission`.
- [ ] Admin short-circuit works.
- [ ] Non-admin without membership is denied.
- [ ] Settings UI edits business entity successfully.
- [ ] Osek Murshe editable and persisted.
- [ ] `scripts/verify-numbering.ts`, `verify-audit.ts`, `verify-rbac.ts` all pass.
- [ ] `npm run lint`, `npm run build` pass.

## Non-goals

- Multi-user tenant UI (invites, accept flow).
- Per-member permission editor.
- Multi-business-per-user UI.
- RBAC for expense (inbound) features.

## Open questions (resolved above)

- Audit chain migration: **truncate and reseed**. Documented in migration.
- `usesOutboundInvoicing` flag: **skip**. Uniform row per user.
- Cross-tenant attempt: return a generic not-found and log to `rbac_denials`.
