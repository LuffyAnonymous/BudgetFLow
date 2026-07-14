import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { AttachmentService, AttachmentParent } from "@/server/services/attachment.service";

const VALID_PARENT_TYPES = ["transaction", "debtPayment", "savingTx", "remittance"];

/**
 * POST /api/attachments/upload
 * Upload a file attachment and link it to a parent financial record.
 *
 * Body: multipart/form-data
 *   - file: File
 *   - parentType: "transaction" | "debtPayment" | "savingTx" | "remittance"
 *   - parentId: string
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart form data" }, { status: 400 });
  }

  const file = formData.get("file");
  const parentType = formData.get("parentType") as string | null;
  const parentId = formData.get("parentId") as string | null;

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (!parentType || !VALID_PARENT_TYPES.includes(parentType)) {
    return NextResponse.json(
      { error: `Invalid parentType. Must be one of: ${VALID_PARENT_TYPES.join(", ")}` },
      { status: 400 }
    );
  }

  if (!parentId) {
    return NextResponse.json({ error: "parentId is required" }, { status: 400 });
  }

  const parent: AttachmentParent = {
    type: parentType as AttachmentParent["type"],
    id: parentId,
  };

  const requestId = req.headers.get("x-request-id") ?? undefined;

  try {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const attachment = await AttachmentService.upload(
      session.user.id,
      parent,
      file.name,
      buffer,
      requestId
    );

    return NextResponse.json({
      id: attachment.id,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      fileSize: attachment.fileSize,
      status: attachment.status,
      createdAt: attachment.createdAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.startsWith("FORBIDDEN")) {
      return NextResponse.json({ error: message }, { status: 403 });
    }
    if (
      message.startsWith("FILE_TOO_LARGE") ||
      message.startsWith("INVALID_FILE_TYPE") ||
      message.startsWith("ATTACHMENT_LIMIT") ||
      message.startsWith("COMBINED_SIZE_LIMIT") ||
      message.startsWith("QUOTA_EXCEEDED")
    ) {
      return NextResponse.json({ error: message }, { status: 422 });
    }
    console.error("Attachment upload error:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}

/**
 * GET /api/attachments/upload
 * List attachments for a parent record.
 *
 * Query params:
 *   - parentType: "transaction" | "debtPayment" | "savingTx" | "remittance"
 *   - parentId: string
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const parentType = searchParams.get("parentType");
  const parentId = searchParams.get("parentId");

  if (!parentType || !VALID_PARENT_TYPES.includes(parentType)) {
    return NextResponse.json({ error: "Invalid or missing parentType" }, { status: 400 });
  }

  if (!parentId) {
    return NextResponse.json({ error: "parentId is required" }, { status: 400 });
  }

  const parent: AttachmentParent = {
    type: parentType as AttachmentParent["type"],
    id: parentId,
  };

  try {
    const attachments = await AttachmentService.listForParent(session.user.id, parent);
    return NextResponse.json(attachments);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.startsWith("FORBIDDEN")) {
      return NextResponse.json({ error: message }, { status: 403 });
    }
    return NextResponse.json({ error: "Failed to list attachments" }, { status: 500 });
  }
}
