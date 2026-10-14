# API, webhooks, and MCP

*Programs talk to InvoLoops through the API reference. This page only tells you where that is, so the instructions cannot drift apart.*

## One write-up of the API

The reference is [the developer docs](/developers): authentication, errors, idempotency, pagination, rate limits, uploads, webhooks, and MCP. The machine-readable list of endpoints is the OpenAPI document linked from that page, and the try-it console is the API reference tab.

This user guide does not copy those endpoints. If a sentence here and a sentence there ever disagree, the developer docs and the OpenAPI document win for anything a program sends.

## Getting a key

An administrator opens **Settings → API keys**, creates a key, and copies it once. The key is a bearer token. Live and test keys are marked on the key itself. Revoke a key there when a person or a program should stop.

## What people usually connect

- Their own software creating drafts and issuing documents.
- A webhook receiver that hears when a document is issued or an extraction finishes. Signing and retries are in the developer docs.
- Claude or another MCP client, using the same key. Setup is the MCP section of the developer docs.

## Related

- [Issuing documents](../03-income-studio/01-issuing-documents.md) — what "issue" means before you automate it.
- [Allocation numbers and reporting](../04-israeli-tax-compliance/01-allocation-and-reporting.md) — a program cannot get an allocation number if the business has not authorized InvoLoops.
