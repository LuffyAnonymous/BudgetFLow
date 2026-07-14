/**
 * File Signature (Magic Bytes) Validator
 *
 * Inspects the raw binary header of an uploaded file to determine
 * whether it matches an allowed type, regardless of the filename or
 * MIME type reported by the browser.
 *
 * This prevents disguised files (e.g., a .jpg that is actually an executable)
 * from being accepted by the server.
 *
 * Allowed types: JPEG, PNG, WebP, PDF
 */

export type AllowedMimeType = "image/jpeg" | "image/png" | "image/webp" | "application/pdf";

type SignatureMatch = {
  mimeType: AllowedMimeType;
  offset: number;
  bytes: number[];
};

const FILE_SIGNATURES: SignatureMatch[] = [
  // JPEG: FF D8 FF
  { mimeType: "image/jpeg", offset: 0, bytes: [0xff, 0xd8, 0xff] },
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  { mimeType: "image/png", offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  // WebP: RIFF....WEBP
  { mimeType: "image/webp", offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
  // PDF: %PDF
  { mimeType: "application/pdf", offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] },
];

const WEBP_SIGNATURE = [0x57, 0x45, 0x42, 0x50]; // 'WEBP' at offset 8

/**
 * Inspects the first bytes of a buffer to detect the file type.
 *
 * @returns The detected MIME type, or null if the file does not match any allowed type.
 */
export function detectMimeType(buffer: Buffer): AllowedMimeType | null {
  for (const sig of FILE_SIGNATURES) {
    const slice = buffer.slice(sig.offset, sig.offset + sig.bytes.length);
    const matches = sig.bytes.every((byte, i) => slice[i] === byte);

    if (!matches) continue;

    // WebP has an additional check at offset 8
    if (sig.mimeType === "image/webp") {
      const webpSlice = buffer.slice(8, 12);
      const isWebp = WEBP_SIGNATURE.every((byte, i) => webpSlice[i] === byte);
      if (!isWebp) continue;
    }

    return sig.mimeType;
  }

  return null;
}

/**
 * Validates a buffer against allowed MIME types.
 * Returns the detected MIME type on success, or throws on failure.
 */
export function validateFileMagicBytes(buffer: Buffer): AllowedMimeType {
  const detected = detectMimeType(buffer);

  if (!detected) {
    throw new Error(
      "INVALID_FILE_TYPE: File type not allowed. Only JPEG, PNG, WebP, and PDF files are accepted."
    );
  }

  return detected;
}
