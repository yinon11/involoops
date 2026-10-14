import type { UploadJobRow } from "@/db/schema/upload-jobs";

export function serializeUploadJob(row: UploadJobRow) {
  return {
    object: "upload_job",
    id: row.id,
    status: row.status,
    file_name: row.fileName,
    content_type: row.contentType,
    size_bytes: row.sizeBytes,
    hint: row.hint ?? {},
    attempts: row.attempts,
    invoice_id: row.invoiceId,
    error_code: row.errorCode,
    error_message: row.errorMessage,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
