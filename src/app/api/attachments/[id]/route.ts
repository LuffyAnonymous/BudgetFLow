import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { AttachmentService } from "@/server/services/attachment.service";


/**
 * GET /api/attachments/[id]
 * Stream a file attachment to the authenticated user.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const { stream, attachment } = await AttachmentService.openStream(session.user.id, id);

    // Convert Node.js ReadableStream to a Response-compatible ReadableStream
    const webStream = new ReadableStream({
      start(controller) {
        const nodeStream = stream as NodeJS.ReadableStream;
        nodeStream.on("data", (chunk: Buffer) => controller.enqueue(chunk));
        nodeStream.on("end", () => controller.close());
        nodeStream.on("error", (err) => controller.error(err));
      },
    });

    return new Response(webStream, {
      headers: {
        "Content-Type": attachment.mimeType,
        "Content-Disposition": `inline; filename="${encodeURIComponent(attachment.originalName)}"`,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.startsWith("FORBIDDEN") || message.startsWith("NOT_FOUND")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to retrieve attachment" }, { status: 500 });
  }
}

/**
 * DELETE /api/attachments/[id]
 * Soft-delete an attachment.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const requestId = req.headers.get("x-request-id") ?? undefined;

  try {
    await AttachmentService.delete(session.user.id, id, requestId);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.startsWith("FORBIDDEN") || message.startsWith("NOT_FOUND")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to delete attachment" }, { status: 500 });
  }
}
