# Team members and roles

*Invite your bookkeeper, accountant, or a colleague into your account — each with their own login and only the permissions you choose.*

You never need to share your password. InvoLoops lets you invite other people into your account from **Settings → Team**. Each person signs in with their own email and password (or Google), and sees only what you allow.

<!-- screenshot: Settings → Team tab showing the Team members card with the invite form and capability checkboxes -->

## Inviting someone

1. Open **Settings** and switch to the **Team** tab. You will see the **Team members** card.
2. Enter the person's email under **Email address**.
3. Under **What can this person do?**, tick the capabilities you want to grant. You can change these at any time later — as the form says, *"You can adjust capabilities at any time after the invitation is accepted."*
4. Click **Send invitation**. The person receives an email with a personal invitation link.

The invitation link is single-use and expires after **7 days**. You can see it waiting under **Pending invitations**, where each row shows the email, the expiry date, and two buttons: **Resend** and **Revoke**. Re-inviting the same email simply replaces the earlier invitation.

## The permissions you can grant

Permissions come in pairs: a "view" permission lets someone see a part of the app, and a matching "manage" permission lets them change it.

| Capability | What it allows |
|---|---|
| **View invoices** | See the expense invoices in your account |
| **Add and edit invoices** | Upload, edit, and delete expense invoices |
| **View vendors** | See your supplier list |
| **Add and edit vendors** | Change supplier details and rules |
| **View customers** | See your customer directory |
| **Add and edit customers** | Change customer details |
| **View outbound invoices** | See the invoices you have issued |
| **Issue outbound invoices** | Create and send invoices to your customers |
| **View reports & dashboards** | Dashboard, Income, Profit, and analytics pages |
| **Manage settings** | Open and change account settings |

A typical "accountant" setup is everything except **Manage settings**. A typical "view-only" setup is just the **View** permissions plus **View reports & dashboards**.

Note that a member *without* **Manage settings** cannot open any Settings page at all — the app sends them back to the Dashboard.

## Accepting an invitation (for the invited person)

1. Open the email and click the invitation link. You land on a page titled **"You've been invited"**, showing who invited you and **Your permissions**.
2. If you don't have an InvoLoops login yet, create one first — the page offers sign-in and registration, and brings you back afterwards.
3. The invitation only works for the exact email address it was sent to. If you are signed in with a different address, you'll see a notice and a **Sign out and try again** link.
4. Accept, and you're in. From now on, signing in takes you straight into the owner's account — use the account menu to switch back to your own.

<!-- screenshot: the /invite/[token] acceptance page with the permissions list and accept button -->

## Managing and removing members

Accepted members appear under **Active members** in the same card. For each member you can:

- Edit their capability checkboxes and click **Save**.
- Toggle **Sign in directly to my account** — when on, this member skips their own dashboard and lands inside your account on every sign-in. Turn it off if they also use InvoLoops for their own business.
- Click **Remove** to take away their access entirely. Their own login keeps existing; only the link to your account is deleted.

## Good to know

- **Only the owner can manage the team.** Someone acting inside your account on your behalf cannot invite, remove, or re-permission members — those actions are reserved for you.
- **You cannot invite yourself**, and a person who is already on your team cannot be invited again.
- **Invitation emails need email sending configured.** On self-hosted InvoLoops instances where outgoing email (Amazon SES) is not set up, the invite email will fail — the app then shows you the invitation link so you can copy it and send it yourself.
- **Behind the scenes, finer roles exist for tax compliance.** For Israeli bookkeeping certification, InvoLoops also carries an internal role model (Owner, Accountant, Issuer, Viewer, Auditor) that separates who may draft, issue, and void tax documents and who may read the audit log. Today you do not assign these roles yourself — the checkbox capabilities above are what you control.

## Related

- [Settings, billing and security](../07-settings-and-billing/01-settings-billing-and-security.md)
- [Getting started: navigating the app](../01-getting-started/04-navigating-the-app.md)
