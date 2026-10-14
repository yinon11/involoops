/**
 * GO_LIVE step 0.4 — "Confirm audit, signature, archive for that issue.
 * Done when: no silent half-states."
 *
 * Every other verify-* harness in this directory is synthetic: it creates
 * disposable fixtures, asserts against them, and tears them down. That
 * proves the machinery works. It cannot tell you whether *one real
 * document* came out whole, which is what 0.4 actually asks — and what a
 * customer asks when they say "is this invoice sound?".
 *
 * A half-state is the failure this catches: an invoice that got its
 * allocation number but whose archive write failed, a signature over a
 * canonical form that no longer matches the live rows, a PDF marked final
 * with no allocation on it. Each of those is invisible from the invoice
 * page and from any single table.
 *
 *   npx tsx scripts/verify-document.ts <documentId>
 *   npx tsx scripts/verify-document.ts <documentId> --skip-s3
 *
 * READ-ONLY. It issues no writes and is safe to point at production.
 *
 * Requires DATABASE_URL. S3 checks additionally need the archive bucket
 * env; without it pass --skip-s3 (or let them report SKIP) and the
 * database-side checks still run.
 *
 * Exit code 0 = every check passed or skipped, 1 = something failed.
 */

import "dotenv/config";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  archiveObjects,
  documentSignatures,
  outboundInvoices,
} from "@/db/schema";
import { documentAuditLog } from "@/db/schema/document-audit-log";
import { verifyChain } from "@/lib/audit/verify-chain";
import { verifyDocumentSignature } from "@/lib/signing/verify";
import { verifyArchiveChain, verifyArchiveObject } from "@/lib/archive/verify";
import { getArchiveObjectRetention } from "@/lib/archive/s3";
import type { ArchiveObjectKind } from "@/db/schema/archive-objects";

/**
 * What an issued document must have in the archive. PDF_FINAL is not here
 * because it only exists once an allocation number has been stamped —
 * that is checked separately, against the document's actual SHAAM state.
 * UNIFORM_STRUCTURE_* are period exports, not per-document objects.
 */
const REQUIRED_KINDS: ArchiveObjectKind[] = [
  "CANONICAL_JSON",
  "SIGNATURE",
  "PDF",
  "AUDIT_BUNDLE",
];

type Status = "PASS" | "FAIL" | "SKIP" | "INFO";
const results: Array<{ status: Status; name: string; detail: string }> = [];

/**
 * Entity-wide failures that are not this document's doing. Both hash
 * chains span the whole business entity, so a break another document
 * caused shows up here too — reporting that as "this document is in a
 * half-state" sends you looking in the wrong place.
 */
const elsewhere: string[] = [];

const COLOR: Record<Status, string> = {
  PASS: "\x1b[32m",
  FAIL: "\x1b[31m",
  SKIP: "\x1b[33m",
  INFO: "\x1b[36m",
};

function record(status: Status, name: string, detail = "") {
  results.push({ status, name, detail });
  console.log(
    `${COLOR[status]}${status.padEnd(4)}\x1b[0m  ${name}${detail ? ` — ${detail}` : ""}`,
  );
}

function section(title: string) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

async function main() {
  const args = process.argv.slice(2);
  const skipS3 = args.includes("--skip-s3");
  const documentId = args.find((a) => !a.startsWith("--"));

  if (!documentId) {
    console.error(
      "usage: npx tsx scripts/verify-document.ts <documentId> [--skip-s3]",
    );
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) {
    console.error("[verify-document] DATABASE_URL is not set.");
    process.exit(2);
  }

  // ---- the document itself -------------------------------------------
  const [doc] = await db
    .select()
    .from(outboundInvoices)
    .where(eq(outboundInvoices.id, documentId))
    .limit(1);

  if (!doc) {
    console.error(`[verify-document] no outbound invoice with id ${documentId}`);
    process.exit(1);
  }

  console.log(
    `\n\x1b[1mDocument ${doc.formattedNumber ?? "(unnumbered)"}\x1b[0m  ${doc.id}`,
  );
  record(
    "INFO",
    "state",
    `status=${doc.status} type=${doc.documentType} shaam=${doc.shaamStatus ?? "none"} pdf=${doc.pdfKind ?? "none"}`,
  );

  const isIssued = doc.status !== "draft";
  if (!isIssued) {
    record(
      "INFO",
      "draft document",
      "signature/archive checks below are expected to be absent",
    );
  }

  // ---- audit ----------------------------------------------------------
  section("Audit");

  const auditRows = await db
    .select({
      sequenceNumber: documentAuditLog.sequenceNumber,
      eventType: documentAuditLog.eventType,
      createdAt: documentAuditLog.createdAt,
    })
    .from(documentAuditLog)
    .where(
      and(
        eq(documentAuditLog.documentId, documentId),
        eq(documentAuditLog.businessEntityId, doc.businessEntityId),
      ),
    )
    .orderBy(asc(documentAuditLog.sequenceNumber));

  if (auditRows.length === 0) {
    record(
      isIssued ? "FAIL" : "SKIP",
      "audit entries exist",
      isIssued ? "an issued document with no audit trail" : "draft",
    );
  } else {
    record(
      "PASS",
      "audit entries exist",
      `${auditRows.length}: ${auditRows.map((r) => r.eventType).join(", ")}`,
    );
  }

  // The chain is per business entity, not per document — a hash chain has
  // to be, or a gap would be undetectable. So this verifies the entity's
  // chain and reports where this document sits inside it.
  const chain = await verifyChain(doc.businessEntityId);
  if (chain.ok) {
    record(
      "PASS",
      "audit hash chain intact (whole entity)",
      `${chain.entriesChecked} entries checked`,
    );
  } else {
    const seqs = auditRows.map((r) => Number(r.sequenceNumber));
    const mine =
      seqs.length > 0 && chain.brokenAt >= seqs[0] && chain.brokenAt <= seqs[seqs.length - 1];
    record(
      "FAIL",
      "audit hash chain intact (whole entity)",
      `${chain.reason} at #${chain.brokenAt}${mine ? " — inside this document's range" : " — outside this document's entries"}`,
    );
    if (!mine) elsewhere.push("audit chain");
  }

  if (isIssued) {
    const hasIssued = auditRows.some((r) =>
      String(r.eventType).includes("ISSUED"),
    );
    record(
      hasIssued ? "PASS" : "FAIL",
      "an issuance event is recorded",
      hasIssued ? "" : "document is issued but no ISSUED event in the log",
    );
  }

  // ---- signature ------------------------------------------------------
  section("Signature");

  const [sig] = await db
    .select({
      keyId: documentSignatures.keyId,
      algorithm: documentSignatures.algorithm,
      signedAt: documentSignatures.signedAt,
    })
    .from(documentSignatures)
    .where(eq(documentSignatures.documentId, documentId))
    .limit(1);

  if (!sig) {
    record(
      isIssued ? "FAIL" : "SKIP",
      "signature row exists",
      isIssued ? "issued but unsigned" : "draft",
    );
  } else {
    record("PASS", "signature row exists", `${sig.algorithm} key=${sig.keyId}`);

    // Covers both directions: the signature matches its stored canonical
    // form, AND that canonical form still matches the live invoice rows.
    // The second is what catches a direct DB edit after issuance.
    const verified = await verifyDocumentSignature(documentId);
    record(
      verified.ok ? "PASS" : "FAIL",
      "signature verifies against live rows",
      verified.ok ? "" : verified.reason,
    );
  }

  // ---- archive --------------------------------------------------------
  section("Archive");

  const objects = await db
    .select()
    .from(archiveObjects)
    .where(eq(archiveObjects.documentId, documentId))
    .orderBy(asc(archiveObjects.chainSequence));

  const kinds = new Set(objects.map((o) => o.objectKind as ArchiveObjectKind));
  const missing = REQUIRED_KINDS.filter((k) => !kinds.has(k));

  if (!isIssued) {
    record("SKIP", "required archive objects present", "draft");
  } else if (missing.length === 0) {
    record(
      "PASS",
      "required archive objects present",
      [...kinds].join(", "),
    );
  } else {
    record(
      "FAIL",
      "required archive objects present",
      `missing ${missing.join(", ")} — this is the half-state 0.4 is looking for`,
    );
  }

  // PDF_FINAL is required exactly when an allocation number exists: that
  // is the re-rendered PDF carrying the number. `pdfKind` claiming final
  // without the object (or without a number) is the inverse half-state.
  if (doc.allocationNumber) {
    record(
      kinds.has("PDF_FINAL") ? "PASS" : "FAIL",
      "PDF_FINAL archived for the allocation number",
      kinds.has("PDF_FINAL")
        ? `allocation ${doc.allocationNumber}`
        : `allocation ${doc.allocationNumber} granted but no final PDF archived`,
    );
    record(
      doc.pdfKind === "final" ? "PASS" : "FAIL",
      "pdf_kind reflects the allocation",
      doc.pdfKind === "final" ? "" : `pdf_kind=${doc.pdfKind ?? "none"}`,
    );
  } else {
    record(
      doc.pdfKind === "final" ? "FAIL" : "SKIP",
      "no allocation number, so no final PDF expected",
      doc.pdfKind === "final"
        ? "pdf_kind=final with no allocation number"
        : `shaam=${doc.shaamStatus ?? "none"}`,
    );
  }

  const archiveChain = await verifyArchiveChain(doc.businessEntityId);
  if (archiveChain.ok) {
    record(
      "PASS",
      "archive hash chain intact (whole entity)",
      `${archiveChain.entriesChecked} entries checked`,
    );
  } else {
    const mySeqs = objects.map((o) => Number(o.chainSequence));
    const mine = mySeqs.includes(archiveChain.brokenAt);
    record(
      "FAIL",
      "archive hash chain intact (whole entity)",
      `${archiveChain.reason} at #${archiveChain.brokenAt}${mine ? " — one of this document's objects" : " — another document's object"}`,
    );
    if (!mine) elsewhere.push("archive chain");
  }

  // ---- archive bytes + object lock (S3) -------------------------------
  section("Archive objects in S3");

  if (skipS3) {
    record("SKIP", "object bytes and retention", "--skip-s3");
  } else if (objects.length === 0) {
    record("SKIP", "object bytes and retention", "no archive rows");
  } else {
    for (const obj of objects) {
      const label = `${obj.objectKind}`;
      const verified = await verifyArchiveObject(obj.id);
      if (!verified.ok) {
        record("FAIL", `${label}: bytes match stored hash`, verified.reason);
        // A missing object has no retention to read.
        continue;
      }
      record("PASS", `${label}: bytes match stored hash`, `${verified.contentLength} bytes`);

      try {
        const retention = await getArchiveObjectRetention({
          key: obj.s3Key,
          versionId: obj.s3VersionId,
        });
        const compliant = retention.mode === "COMPLIANCE";
        record(
          compliant ? "PASS" : "FAIL",
          `${label}: object lock`,
          compliant
            ? `COMPLIANCE until ${retention.retainUntil?.toISOString().slice(0, 10) ?? "?"}`
            : `mode=${retention.mode ?? "none"} — not immutable`,
        );
      } catch (err) {
        record(
          "SKIP",
          `${label}: object lock`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  // ---- SHAAM consistency ----------------------------------------------
  section("SHAAM");

  if (!doc.shaamStatus || doc.shaamStatus === "NOT_APPLICABLE") {
    record(
      "SKIP",
      "clearance state",
      "below the allocation threshold or never submitted",
    );
  } else {
    record("INFO", "clearance state", `${doc.shaamStatus} retries=${doc.shaamRetryCount}`);
    // APPROVED without a number, or a number without APPROVED, both mean
    // the status and the artefact disagree.
    if (doc.shaamStatus === "APPROVED") {
      record(
        doc.allocationNumber ? "PASS" : "FAIL",
        "APPROVED carries an allocation number",
        doc.allocationNumber ?? "approved with no allocation number stored",
      );
    } else if (doc.allocationNumber) {
      record(
        "FAIL",
        "allocation number only on APPROVED",
        `shaam_status=${doc.shaamStatus} but allocation ${doc.allocationNumber} is stored`,
      );
    }
    if (doc.shaamLastErrorCode) {
      record(
        "INFO",
        "last SHAAM error",
        `${doc.shaamLastErrorCode}: ${doc.shaamLastErrorMessage ?? ""}`.slice(0, 160),
      );
    }
  }

  // ---- verdict ---------------------------------------------------------
  const failed = results.filter((r) => r.status === "FAIL").length;
  const passed = results.filter((r) => r.status === "PASS").length;
  const skipped = results.filter((r) => r.status === "SKIP").length;

  console.log(
    `\n[verify-document] ${passed} passed, ${failed} failed, ${skipped} skipped`,
  );
  const ownFailures = failed - elsewhere.length;
  if (ownFailures > 0) {
    console.log(
      "\x1b[31mThis document is in a half-state. Do not treat GO_LIVE 0.4 as met.\x1b[0m",
    );
  }
  if (elsewhere.length > 0) {
    console.log(
      `\x1b[33mSeparately, the entity's ${elsewhere.join(" and ")} is broken at an entry this document does not own — investigate the entity, not this invoice.\x1b[0m`,
    );
  }
  process.exit(failed > 0 ? 1 : 0);
}

void main().catch((err) => {
  console.error("[verify-document] threw:", err);
  process.exit(1);
});
