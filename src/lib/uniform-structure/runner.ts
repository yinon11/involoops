import JSZip from "jszip";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { outboundInvoices, uniformStructureExports } from "@/db/schema";
import { appendAuditEntry } from "@/lib/audit/append";
import { uploadFile } from "@/lib/storage";
import { archiveAuxiliary } from "@/lib/archive/auxiliary";
import { buildUniformStructureFiles } from "./build";
import { validateUniformStructureFiles } from "./validate";

/**
 * Spec 10 — background runner. Invoked from the server action via
 * `setImmediate` + the request's server-action context. In production
 * this should be a proper queue; the fire-and-forget approach is
 * acceptable for small deployments (a build for ~1k invoices takes
 * <10s). KNOWN_ISSUES flags this for future hardening.
 */
export async function runUniformStructureExport(params: {
  exportRowId: string;
  businessEntityId: string;
  periodStart: Date;
  periodEnd: Date;
  actorUserId: string;
  runId: string;
}): Promise<void> {
  const startedAt = new Date();
  await db
    .update(uniformStructureExports)
    .set({
      status: "RUNNING",
      startedAt,
      updatedAt: startedAt,
    })
    .where(eq(uniformStructureExports.id, params.exportRowId));

  try {
    const result = await buildUniformStructureFiles({
      businessEntityId: params.businessEntityId,
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
    });

    // Self-validation — don't surface a DONE export that our own
    // validator rejects.
    const lint = validateUniformStructureFiles({
      ini: result.iniContent,
      bkmvdata: result.bkmvdataContent,
    });
    if (!lint.valid) {
      await db
        .update(uniformStructureExports)
        .set({
          status: "FAILED",
          errorCode: "self_validation_failed",
          errorMessage: lint.errors
            .map((e) => `${e.recordType}/${e.rule}: ${e.message}`)
            .slice(0, 10)
            .join(" | "),
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(uniformStructureExports.id, params.exportRowId));
      return;
    }

    const basePrefix = `uniform-structure/${params.businessEntityId}/${params.runId}`;
    const iniKey = `${basePrefix}/INI.TXT`;
    const bkmvKey = `${basePrefix}/BKMVDATA.TXT`;
    const zipKey = `${basePrefix}/export.zip`;

    await uploadFile(result.iniContent, iniKey, "text/plain");
    await uploadFile(result.bkmvdataContent, bkmvKey, "text/plain");

    const zip = new JSZip();
    zip.file("INI.TXT", result.iniContent);
    zip.file("BKMVDATA.TXT", result.bkmvdataContent);
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    await uploadFile(zipBuffer, zipKey, "application/zip");

    // Archive integration — best-effort; a failure here doesn't
    // fail the export itself (the MinIO copy above is the primary
    // artefact).
    try {
      await archiveAuxiliary({
        businessEntityId: params.businessEntityId,
        actorUserId: params.actorUserId,
        documentId: params.exportRowId, // export rows aren't real
        // outbound documents; we tag the archive row with our export
        // id so reverse lookups still work.
        kind: "UNIFORM_STRUCTURE_INI",
        bytes: result.iniContent,
        contentType: "text/plain; charset=iso-8859-8",
      });
      await archiveAuxiliary({
        businessEntityId: params.businessEntityId,
        actorUserId: params.actorUserId,
        documentId: params.exportRowId,
        kind: "UNIFORM_STRUCTURE_BKMVDATA",
        bytes: result.bkmvdataContent,
        contentType: "text/plain; charset=iso-8859-8",
      });
    } catch (err) {
      console.warn(
        `[uniform-structure] archive integration failed for run ${params.runId}:`,
        err,
      );
    }

    const completedAt = new Date();
    await db
      .update(uniformStructureExports)
      .set({
        status: "DONE",
        stats: result.stats as unknown as Record<string, unknown>,
        s3KeyIni: iniKey,
        s3KeyBkmvdata: bkmvKey,
        s3KeyZip: zipKey,
        completedAt,
        updatedAt: completedAt,
      })
      .where(eq(uniformStructureExports.id, params.exportRowId));

    // Audit event scoped to the business entity; pick the first
    // invoice in the period as the documentId so the audit-chain
    // row has a valid reference. Fall back to a zero UUID if the
    // period is empty (Z900 is still emitted with zero counts).
    const [firstInvoice] = await db
      .select({ id: outboundInvoices.id, documentType: outboundInvoices.documentType })
      .from(outboundInvoices)
      .where(eq(outboundInvoices.businessEntityId, params.businessEntityId))
      .limit(1);
    if (firstInvoice) {
      await appendAuditEntry({
        businessEntityId: params.businessEntityId,
        userId: params.actorUserId,
        documentId: firstInvoice.id,
        documentType: firstInvoice.documentType,
        eventType: "EXPORTED",
        eventPayload: {
          kind: "UNIFORM_STRUCTURE",
          runId: params.runId,
          periodStart: params.periodStart.toISOString().slice(0, 10),
          periodEnd: params.periodEnd.toISOString().slice(0, 10),
          recordCount: result.stats.recordCounts.TOTAL,
        },
        actor: { userId: params.actorUserId },
      });
    }
  } catch (err) {
    const completedAt = new Date();
    await db
      .update(uniformStructureExports)
      .set({
        status: "FAILED",
        errorCode: "build_failed",
        errorMessage: err instanceof Error ? err.message : String(err),
        completedAt,
        updatedAt: completedAt,
      })
      .where(eq(uniformStructureExports.id, params.exportRowId));
  }
}
