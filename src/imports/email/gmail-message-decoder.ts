/**
 * src/imports/email/gmail-message-decoder.ts
 *
 * Extracts a plain-text body from a Gmail API message payload. Gmail
 * already parses MIME structure server-side (payload.parts), so this just
 * walks that structure looking for a text/plain part first, falling back
 * to text/html (tags stripped) if that's all the message has — no MIME
 * parsing dependency needed.
 */

export interface GmailMessagePart {
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  parts?: GmailMessagePart[] | null;
}

export type GmailMessagePayload = GmailMessagePart;

function base64UrlDecode(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Recursively finds a text/plain body part, falling back to text/html.
 * Prefers whichever part is found first at each MIME-type tier — a
 * multipart/alternative message typically lists text/plain before
 * text/html, matching the usual preference order.
 */
export function decodeGmailMessageBody(payload: GmailMessagePayload | undefined | null): string | null {
  if (!payload) return null;

  let plainText: string | null = null;
  let htmlText: string | null = null;

  function walk(part: GmailMessagePart): void {
    if (part.parts && part.parts.length > 0) {
      for (const child of part.parts) walk(child);
      return;
    }
    if (!part.body?.data) return;
    const decoded = base64UrlDecode(part.body.data);
    if (part.mimeType === "text/plain" && !plainText) {
      plainText = decoded;
    } else if (part.mimeType === "text/html" && !htmlText) {
      htmlText = decoded;
    }
  }

  walk(payload);

  if (plainText) return plainText;
  if (htmlText) return stripHtml(htmlText);
  return null;
}
