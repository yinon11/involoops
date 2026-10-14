# Spec 09 — Tenant ITA Onboarding

Archive copy. Canonical source: conversation transcript.

> **Amendment (post-spec):** the state enum was originally 5-state
> (`NOT_STARTED`, `GOV_SETUP_REQUIRED`, `READY_TO_AUTHORIZE`,
> `AUTHORIZED`, `EXPIRED`). `NOT_STARTED` was indistinguishable from
> `GOV_SETUP_REQUIRED` in practice — both produced
> `FILL_OSEK_MURSHE` as the next action — so the enum was collapsed
> to 4 states during validation. Fresh entities with no data now
> return `GOV_SETUP_REQUIRED`.

## Summary

Turns Spec 07's OAuth machinery into a guided tenant flow at
`/settings/ita-integration`. Still admin-gated until Form 513 is
approved; the `ITA_INTEGRATION_MANAGE` permission is plumbed through
so the gate can be lifted in one line.

## New code

- `src/db/schema/shaam-tenant-readiness.ts` — self-report checklist row.
- `src/db/schema/notification-sent-log.ts` — tiny dedup table.
- `src/lib/shaam/tenant-readiness.ts` — `getTenantReadiness`,
  `resetReadinessOnOsekMursheChange`, `setReadinessStep`,
  `setSupportContact`, `saveReadinessNotes`.
- `src/lib/shaam/notifications.ts` — SES sends for expiry/expired/stuck
  kinds, dedup'd via `notification_sent_log`.
- `src/actions/shaam-actions.ts` — readiness actions + admin
  `sendStuckReminderForEntity` + `listReadinessStates`.
- `src/app/(app)/settings/ita-integration/page.tsx` — main onboarding
  surface.
- `src/components/settings/ita-integration/*` — progress tracker +
  step cards.
- `src/app/(app)/tutorials/ita-integration/page.tsx` — placeholder
  tutorial.
- `src/app/api/cron/shaam-stuck-reminder/route.ts` — weekly cron.
- Migration `drizzle/0030_tenant_readiness.sql`.
- `scripts/verify-tenant-readiness.ts` — 10 scenarios.

## Modified

- `src/app/api/cron/shaam-expire-scan/route.ts` — now fires
  14/7/1-day expiry warnings + terminal expired notice.
- `src/actions/business-entity-actions.ts` — osek_murshe change resets
  readiness + revokes ACTIVE auth.
- `src/components/settings/business-entity-form.tsx` — inline
  osek_murshe required/format validation.
- `src/app/(app)/admin/shaam/page.tsx` — new readiness column +
  filter + row-level "Send reminder" button.
- `src/lib/rbac/permissions.ts` — new `ITA_INTEGRATION_MANAGE`
  permission, granted to OWNER and ACCOUNTANT.
- `src/app/(app)/settings/page.tsx` — links to the new onboarding
  page via `ItaIntegrationLinkCard`.
- i18n: full `businessEntity.errors.*` + `onboarding.*` keys in en + he.

## Next-action surface map

| state | action | banner | primary CTA |
|-------|--------|--------|-------------|
| GOV_SETUP_REQUIRED | `FILL_OSEK_MURSHE` | none | "Open business entity settings" |
| GOV_SETUP_REQUIRED | `CONFIRM_AZOR_ISHI` | none | checkbox + Continue |
| GOV_SETUP_REQUIRED | `CONFIRM_TAAGID` | none | checkbox + Continue |
| GOV_SETUP_REQUIRED | `CONFIRM_MORSHE_AL` | none | checkbox + Continue |
| READY_TO_AUTHORIZE | `START_OAUTH` | none | "Authorize InvoLoops with ITA" |
| AUTHORIZED + <14d | `RENEW_SOON` | amber "Expires in {N} days" | "Authorize InvoLoops with ITA" |
| EXPIRED / REVOKED / ERROR | `REAUTHORIZE` | red "Authorization expired on {date}" | "Authorize InvoLoops with ITA" |
| AUTHORIZED + healthy | `NONE` | green "Connected successfully" | Test connection / Disconnect |

## Verification script

`npx tsx scripts/verify-tenant-readiness.ts` — covers the 5 states,
the near-expiry and revoke variants, the osek_murshe change-reset,
the notification dedup UNIQUE constraint, and the taagid-auto-true
shortcut for `OSEK_MURSHE` entity type.
