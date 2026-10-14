import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildFileKey, getPresignedUploadUrl } from "@/lib/storage";
import { v4 as uuidv4 } from "uuid";
import { getDictionary } from "@/lib/i18n/server";

export async function POST(req: NextRequest) {
  const session = await auth();
  const dict = await getDictionary();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: dict.errors.unauthorized },
      { status: 401 }
    );
  }

  const { fileName, contentType } = await req.json();

  if (!fileName || !contentType) {
    return NextResponse.json(
      { error: dict.errors.fileNameAndTypeRequired },
      { status: 400 }
    );
  }

  const ext = fileName.split(".").pop() || "";
  const uniqueName = `${uuidv4()}.${ext}`;
  const key = buildFileKey(session.user.id, uniqueName);

  const url = await getPresignedUploadUrl(key, contentType);

  return NextResponse.json({ url, key });
}
