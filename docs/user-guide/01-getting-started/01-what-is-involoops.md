# What is InvoLoops?

*InvoLoops keeps both halves of your bookkeeping in one place: the invoices you receive (expenses) and the legal Israeli documents you issue (income).*

If you run an osek murshe (עוסק מורשה), an osek patur (עוסק פטור), or a small company, you probably juggle two piles of paper: supplier invoices you need to record, and your own invoices you need to issue. InvoLoops handles both piles in one app, under one account.

## The two sides of the app

### 1. The Expenses inbox — invoices you receive

Drop a PDF or photo of any supplier invoice into InvoLoops, and AI extraction reads it for you: vendor, date, amount, VAT, currency, and invoice number, each with a confidence score. You can also forward invoices straight from your email inbox to a personal forwarding address.

Nothing is booked automatically. Every extracted invoice first lands in the **Pending** queue, where you can correct any field, then approve or reject it. Only approved invoices count toward your dashboards and VAT estimates. The app also watches for duplicate uploads, so you do not record (or pay) the same invoice twice.

<!-- screenshot: the Upload page with the drag-and-drop zone and the "Recently Processed" card -->

### 2. The Income Studio — documents you issue

The income side (branded **InvoLoops Studio**) issues your own documents to customers: **Tax Invoice**, **Tax Invoice Receipt**, **Receipt**, **Credit Invoice**, **Proforma Invoice**, and **Delivery Note**. You manage customers, design a template with your logo and colors, track who has not paid yet (**Collections**), and bill project milestones (**Projects**).

Because both sides live in one account, the app can answer the question neither side can alone: the **Profit** view puts what you billed next to what you spent, and the **Taxes** section estimates VAT, income tax, and Bituach Leumi from the same records.

## One app, two sections — and the switcher

The two sides used to be separate "modes" you switched between. Today they are simply sections of one sidebar: an **Income** group and an **Expenses** group, each opening on its own **Overview**. The purple **New** button at the top of the sidebar offers the two everyday actions — **Send Invoice** and **Add Expense** — so you never have to think about which "side" you are on.

The brand mark at the top of the sidebar is a switcher only for platform administrators, who can flip between the regular app and **InvoLoops Admin** (the compliance console). Regular users see the plain InvoLoops brand there.

See [Navigating the app](04-navigating-the-app.md) for a full tour of the sidebar.

## Who it's for

- Freelancers and solo businesses (עוסק מורשה / עוסק פטור) who want invoicing plus expense tracking without a full accounting suite.
- Small companies (ח.פ.) that issue invoices and need their expense paper trail organized for the bookkeeper.
- Accountants and team members — the owner can invite additional logins with limited capabilities (see **Settings → Team members**).

You do not need any bookkeeping background: the app names things in plain language ("Money in", "Money out", "Who owes you") and keeps the tax terminology — allocation number (מספר הקצאה), Uniform Structure (מבנה אחיד) — where it legally belongs, on the documents themselves.

## What makes it compliant (in one paragraph)

Issued documents are built for Israeli law, not just for looks. When an invoice crosses the Israel Invoice (חשבונית ישראל) threshold, InvoLoops requests a 9-digit **allocation number (מספר הקצאה)** from the Tax Authority so your customer can deduct VAT. On issue, every document is **digitally signed**, rendered as a final PDF with a verification QR code, and written to a tamper-protected archive with a full audit trail — issued invoices can never be edited, only credited. You can also export your books in the ITA's **Uniform Structure (מבנה אחיד)** format for your accountant. Connecting to the Tax Authority, the amount that triggers an allocation number, and the exports are in [Allocation numbers and reporting](../04-israeli-tax-compliance/01-allocation-and-reporting.md).

## Good to know

- **AI extraction is optional but recommended.** The operator of your InvoLoops server can configure an Anthropic key, or you can bring your own key in **Settings** (BYOK). Without a key, scanned (image-only) PDFs cannot be read automatically.
- **Self-hosted installs:** InvoLoops is open source. On a self-hosted copy, issuing legal Israeli tax documents stays paused until the operating business holds its own ITA software registration — you will see "**Issuing is paused**" on drafts if that applies.
- **Your data is yours alone.** Every record is scoped to your account; users on the same server never see each other's invoices, vendors, or customers.

## Related

- [Creating your account](02-creating-your-account.md)
- [First steps](03-first-steps-checklist.md)
- [Navigating the app](04-navigating-the-app.md)
- [Dashboards](../05-dashboards-reports/01-expense-dashboard.md)
- [Allocation numbers and reporting](../04-israeli-tax-compliance/01-allocation-and-reporting.md)
