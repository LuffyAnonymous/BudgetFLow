import { describe, it, expect } from "vitest";
import { decodeGmailMessageBody } from "../../../../src/imports/email/gmail-message-decoder";

function b64url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("decodeGmailMessageBody", () => {
  it("returns null for a missing payload", () => {
    expect(decodeGmailMessageBody(null)).toBeNull();
    expect(decodeGmailMessageBody(undefined)).toBeNull();
  });

  it("decodes a single text/plain part", () => {
    const payload = { mimeType: "text/plain", body: { data: b64url("Hello AED 50.00") } };
    expect(decodeGmailMessageBody(payload)).toBe("Hello AED 50.00");
  });

  it("prefers text/plain over text/html in a multipart/alternative message", () => {
    const payload = {
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: b64url("Plain body AED 50.00") } },
        { mimeType: "text/html", body: { data: b64url("<p>HTML body AED 50.00</p>") } },
      ],
    };
    expect(decodeGmailMessageBody(payload)).toBe("Plain body AED 50.00");
  });

  it("falls back to text/html with tags stripped when no text/plain part exists", () => {
    const payload = {
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/html", body: { data: b64url("<div>Debit Amount: <b>AED 302.00</b></div>") } },
      ],
    };
    const result = decodeGmailMessageBody(payload);
    expect(result).toContain("Debit Amount:");
    expect(result).toContain("AED 302.00");
    expect(result).not.toContain("<b>");
  });

  it("walks nested multipart/mixed -> multipart/alternative structures", () => {
    const payload = {
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [{ mimeType: "text/plain", body: { data: b64url("Nested body content") } }],
        },
        { mimeType: "application/pdf", body: { data: b64url("not-relevant-binary") } },
      ],
    };
    expect(decodeGmailMessageBody(payload)).toBe("Nested body content");
  });
});
