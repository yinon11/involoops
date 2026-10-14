# Issuing documents

*Drafts are editable. Issued documents are not. A mistake after issue is fixed with a credit document.*

<!-- screenshot: the new-invoice form with document type and customer -->

## Set the business first

**Settings → Business details** is what the PDF prints: legal name, address, tax id. The first save registers that business in InvoLoops. The template (logo, accent color, language) is separate, under **Settings → Template**.

## Customers

**Income → Clients** is the directory. A document is addressed to one customer. Above a fixed amount on an ILS invoice, the form asks for the customer's tax id.

## Document types

| Type | Use it when |
|---|---|
| **Tax invoice** | You are charging VAT and the customer still owes you. |
| **Tax invoice / receipt** | You charged VAT and you were paid in the same document. |
| **Receipt** | You were paid, including against a tax invoice you already issued. |
| **Credit invoice** | You need to reduce or cancel a tax invoice (or a tax invoice / receipt) that was already issued. |
| **Proforma invoice** | A quote-style request for payment, not a tax invoice. |
| **Delivery note** | Goods moved, not a tax invoice. |

The default when you start a new document is a tax invoice.

## Draft, then issue

**Send Invoice** starts a draft. You can leave and come back. **Issue** assigns the number, signs the PDF, and — when the amount is over the Tax Authority threshold — requests an allocation number.

After issue, the lines and the customer are locked. To correct money, issue a **credit invoice** against that document. Credit invoices apply to tax invoices and tax invoice / receipts that have been issued.

<!-- screenshot: an issued document with its number and PDF -->

## After it is issued

- **Documents** lists drafts and issued files. Download the PDF from the document.
- **Collections** shows what is still unpaid.
- Sending by email, when mail is configured on the server, uses the address on the customer.

On a self-hosted copy, issuing legal Israeli documents stays paused until that business has its own Tax Authority software registration. Drafts still save. The screen says issuing is paused.

Allocation, signatures, and the archive are in [Allocation numbers and reporting](../04-israeli-tax-compliance/01-allocation-and-reporting.md).
