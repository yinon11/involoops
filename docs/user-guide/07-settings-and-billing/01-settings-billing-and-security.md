# Settings, billing, and security

*Business identity, how the PDF looks, who pays for the hosted service, and how you sign in.*

## Business details and template

**Business details** is the legal identity printed on every PDF. **Template** is the logo, accent color, and language of that PDF. Changing the template does not rewrite documents you already issued.

## Team

Invitations and capabilities are **Settings → Team**. The full description is [Team members and roles](../06-team-and-access/01-team-members-and-roles.md). Someone without the settings capability cannot open Settings at all.

## Signing in

Use your own password. Turn on multi-factor authentication from the security section of Settings when you want a second step at login. Google sign-in, when the server has it enabled, is an alternative to the password, not a second account.

## Billing

On the hosted InvoLoops service, the plan and payment method are under Settings. A self-hosted install does not bill you through this screen; whoever runs the server decides that.

## Your own AI key

Expense extraction can use the server's key or a key you paste under Settings. The key is stored encrypted. Without any key, image-only scans are not read automatically. Text PDFs can still be processed.

## Export and deletion

You can export your data and ask for the account to be deleted from Settings. Deletion follows the privacy notice: issued tax documents may have to stay in the archive for the legal retention period even after the login is gone. Read the privacy policy for the exact rule before you rely on this paragraph.

## API keys

**Settings → API keys** creates a key for a program. What that key can call is documented only in the [API reference](/developers).
