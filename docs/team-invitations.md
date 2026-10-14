# Team invitations & sub-user capabilities

Owners can invite other users to access their account from
**Settings → Team**. Each invited user signs in with their own login and
receives a configurable set of capabilities (granular permissions) while
acting on behalf of the owner.

## Concepts

| Term | Meaning |
|------|---------|
| **Owner** | The user that pays for and owns the data. Always has full access. |
| **Sub-user (member)** | A separate user that the owner has granted scoped access to. |
| **Invitation** | A pending email invite carrying a single-use, 7-day token. |
| **Account link** | The persistent `manager_user_id → managed_user_id` row created on accept. The sub-user is the `manager`; the owner is the `managed`. |
| **Capability** | A code (`view_invoices`, `manage_invoices`, …) stored on the link as a JSONB array. |

The feature is built on the existing **switch-account** mechanism: once
linked, the sub-user logs in normally and is *automatically* placed
inside the owner's account when they have exactly one linked owner (the
default — see "Auto-act-as on sign-in" below). They can always use the
avatar menu to switch back, exactly like an admin impersonation.

## Capabilities

Capabilities live in `src/lib/team/capabilities.ts` (client-safe). The
canonical set is:

| Code | Grants |
|------|--------|
| `view_invoices` | Read inbound invoices |
| `manage_invoices` | Create / edit / delete inbound invoices |
| `view_vendors` | Read vendors |
| `manage_vendors` | Create / edit / delete vendors |
| `view_customers` | Read customers |
| `manage_customers` | Create / edit / delete customers |
| `view_outbound` | Read issued (outbound) invoices |
| `manage_outbound` | Create / send outbound invoices |
| `view_reports` | Dashboard / Income / Profit / analytics |
| `manage_settings` | Modify account settings |

`view_*` is data visibility; `manage_*` is create/update/delete on the
same domain. Granting a `manage_*` without the matching `view_*` is
allowed but pointless; the UI presents them side-by-side.

> **Note.** This PR ships the storage, helpers, owner-facing UI, and the
> invitation/accept flows. Wiring `hasCapability(...)` into every
> existing route or query is a follow-up — `resolveCapabilities()` is
> the single entry point to use when adding those checks.

## Data model

### `account_invitations` (new)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `owner_user_id` | uuid FK → `users.id` (cascade) | Account that issued the invite. |
| `email` | varchar(255) | Lower-cased recipient email. |
| `token` | varchar(64) UNIQUE | 32 bytes hex (`crypto.randomBytes`). Single-use. |
| `capabilities` | jsonb (default `[]`) | Codes the sub-user will receive on accept. |
| `expires_at` | timestamp | 7 days from creation. |
| `accepted_at` | timestamp NULL | Set on accept. |
| `revoked_at` | timestamp NULL | Set when the owner revokes. |
| `created_at` | timestamp | |

Indexed by `owner_user_id` and `email`.

### `account_links` (extended)

A `capabilities` JSONB column was added (default `[]`). The rest of the
table is unchanged: `manager_user_id` is the sub-user, `managed_user_id`
is the owner.

An `auto_act_as` boolean column (default `true`) controls whether the
post-login resolver auto-switches the sub-user into the owner's account
on sign-in. See "Auto-act-as on sign-in" below.

Migrations:
- `drizzle/0018_team_invitations_and_capabilities.sql` — initial schema.
- `drizzle/0024_account_links_auto_act_as.sql` — adds `auto_act_as`.

Apply with `npx drizzle-kit push` or psql before deploy.

## Flow

```
Owner → Settings → Team
  │
  │ create invitation (email + caps)
  ▼
account_invitations row inserted, token generated
  │
  ▼
SES sends email with /invite/<token> link (7-day expiry)
  │
  ▼
Recipient clicks link → /invite/[token] page
  ├── not signed in     → CTA: Sign in / Create account (callback returns here)
  ├── signed in, wrong  → "wrong account" notice + sign-out link
  └── signed in, right  → "Accept invitation" button
        │
        ▼
   accept action:
     - mark invitation accepted_at
     - upsert account_links(manager=member, managed=owner, capabilities=...)
  │
  ▼
Sub-user signs in normally → avatar menu shows owner under "Switch
account" → click to act-as. Existing JWT plumbing (`originator` claim,
`isSwitchBack`, etc.) keeps the switch reversible and prevents chains.
```

## Auto-act-as on sign-in

A pure sub-user (someone you invited who has no own data) should not
have to open the avatar menu and click "Switch account" after every
login. The post-login resolver does this automatically.

**Conditions for an automatic switch on sign-in:**

1. The user has **exactly one** `account_links` row as `manager_user_id`
   (one owner). Two or more is ambiguous and falls through to their
   own dashboard.
2. That link's `auto_act_as` flag is `true` (default on; the owner can
   disable per-member from Settings → Team).
3. The `iv_switch_back` cookie is **not** set. This cookie is written
   when the user explicitly clicks **Switch back to {owner}** in the
   avatar menu and lives for 6 hours, so we don't bounce them right
   back into the owner after they deliberately opted out for the
   session.

**Implementation:**

- All sign-in entry points (`credentials` and `google`) redirect to
  `/api/auth/resolve-entry-session` after authentication instead of
  going directly to `/dashboard`. The resolver runs the three checks
  above and calls `signIn("switch-account", ...)` when they pass.
- The resolver also handles the existing "user with an `originator`
  session enters the app" case (switch back to the originator).
- Deep-links are preserved: `?next=/some/path` on the resolver becomes
  the final `redirectTo` for both the auto-switch and the fallback.

**Files:**

- `src/app/api/auth/resolve-entry-session/route.ts` — the resolver.
- `src/lib/team/switch-back-cookie.ts` — read/write/clear the
  `iv_switch_back` cookie.
- `src/actions/account-link-actions.ts` — `switchAccountAction(targetId,
  viaSwitchBack)` writes the cookie on switch-back and clears it on
  forward switches.

## Owner UI

`Settings → Team` (`src/components/settings/team-card.tsx`) provides:

- **Invite form** — email + checkbox grid of capabilities + submit.
- **Pending invitations** — email, expiry date, capability count, **Revoke**.
- **Active members** — name/email, a **Sign in directly to my account**
  toggle (`auto_act_as`), full editable capability grid, **Save** when
  dirty, **Remove** to delete the link.

Re-inviting the same email replaces the prior pending row (idempotent
"resend").

## Files

| File | Purpose |
|------|---------|
| `drizzle/0018_team_invitations_and_capabilities.sql` | Schema migration |
| `src/db/schema/account-invitations.ts` | Drizzle table |
| `src/db/schema/account-links.ts` | `capabilities` column added |
| `src/lib/team/capabilities.ts` | Capability codes + types (client-safe) |
| `src/lib/team/server.ts` | `resolveCapabilities`, `listTeamMembers` (server-only) |
| `src/lib/email/team-invite.ts` | Direct-SES bilingual invite email |
| `src/actions/team-invitation-actions.ts` | create / revoke / accept / update / remove / lookup |
| `src/components/settings/team-card.tsx` | Owner-facing Settings UI |
| `src/app/invite/[token]/page.tsx` | Public accept page |
| `src/app/invite/[token]/accept-button.tsx` | Client component for the accept action |
| `src/lib/i18n/dictionaries/{en,he}.ts` | UI strings (`settings.team`, `invitePage`) |
| `src/auth.config.ts` | `/invite/*` added to public allowlist |

## Security notes

- **Token** is 64 hex chars (32 bytes), single-use, deleted on accept.
  Expiry is enforced both at lookup and at accept (gt(expiresAt, now)).
- **Email match enforced**: the signed-in user's email must equal the
  invitation's email or accept fails.
- **Self-invite blocked**: cannot invite the owner's own email or accept
  your own invitation.
- **Owner-only mutations**: every mutation re-reads the session and
  rejects when `originator` is set (i.e. when the caller is acting-as
  another user via switch-account).
- **No user enumeration**: invitation lookup by token never exposes the
  owner's id; `email` is only revealed on a successful match.
- **Email is sent directly via SES**, not via the `email_logs` /
  templates pipeline, because the recipient may not yet have a user
  record. Failures surface to the owner so they can copy the link
  manually if SES is misconfigured locally.

## Deployment checklist

1. Apply `drizzle/0018_team_invitations_and_capabilities.sql`.
2. Apply `drizzle/0024_account_links_auto_act_as.sql` (adds the
   `auto_act_as` column on existing links; default `true`).
3. Verify `SES_*` env vars are set (the invite email skips the DB
   template store and goes through SES directly).
4. `AUTH_URL` must be the public URL — it's used to build the
   `/invite/<token>` link and controls cookie `Secure` flag.
