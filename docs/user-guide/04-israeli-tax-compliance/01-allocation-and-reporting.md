# Allocation numbers and reporting

*What the Tax Authority requires on the documents you issue, and where InvoLoops does that work.*

This is not tax advice. It is a map of the screens.

## Allocation numbers

When a tax invoice (or a tax invoice / receipt) is at or above the Tax Authority's amount for that date, InvoLoops requests a **9-digit allocation number (מספר הקצאה)** as part of issuing. Your customer uses that number to deduct VAT.

The threshold is on the amount before VAT, and it has stepped down over time. From 1 June 2026 it is **5,000 NIS** before VAT. Earlier issue dates use the threshold that was in force on that date (10,000 from January 2026, 20,000 through 2025, 25,000 from May 2024). Below the threshold, the invoice issues without an allocation request.

<!-- screenshot: the ITA settings page showing connection status -->

## Connecting, once

The Tax Authority only accepts allocation requests from software the business has authorized on gov.il. An administrator opens **Taxes → ITA** and completes that authorization. It is once per business, and it has to be renewed when the Tax Authority says so. The status on that page is the thing to read before you issue a large invoice: if there is no active authorization, an above-threshold invoice will not issue.

The login page you see during authorization is the Tax Authority's, in your browser. InvoLoops does not ask you to type that password into InvoLoops.

## If the Tax Authority refuses

The document stays unissued. The screen shows the refusal. Fix the cause they named (often the authorization, the customer tax id, or the amount) and issue again. Do not keep a second draft of the same sale if the first one actually issued — check **Documents** first.

## What issue writes down

On issue, the PDF is rendered, **digitally signed**, and stored in an archive that the app will not overwrite. An audit log records the issue. That log is append-only: the database role the app uses cannot change or delete those rows.

Issued documents are not edited. A credit invoice is how you reverse one.

## Exports for the accountant

- **Uniform Structure (מבנה אחיד)** — the Tax Authority's file format, under **Taxes**.
- **Hashavshevet** — the export next to it, for that bookkeeping software.
- **VAT estimates** — a working figure from the expenses you approved and the documents you issued. It is an estimate inside the app, not a filing to the Tax Authority.

## Related

- [Issuing documents](../03-income-studio/01-issuing-documents.md)
- [API, webhooks, and MCP](../08-integrations-api/01-api-and-webhooks.md) — only if a program issues documents for you. The endpoint list lives on the API reference, not here.
