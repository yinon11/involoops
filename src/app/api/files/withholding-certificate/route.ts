import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getBusinessEntityForUserOrNull } from "@/lib/rbac/current-business-entity";
import { downloadFile } from "@/lib/storage";
import { withholdingCertificateObjectKey } from "@/lib/documents/withholding-certificate";

/**
 * Stream the caller's saved withholding-tax certificate.
 * The object key is taken from the business row, never from the query string.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const entity = await getBusinessEntityForUserOrNull(session.user.id);
  const expected = entity
    ? withholdingCertificateObjectKey(entity.ownerUserId)
    : null;
  if (!entity?.withholdingCertificateKey || entity.withholdingCertificateKey !== expected) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const buffer = await downloadFile(entity.withholdingCertificateKey);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="withholding-certificate.pdf"',
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
