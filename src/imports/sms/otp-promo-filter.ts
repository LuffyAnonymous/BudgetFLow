/**
 * Shared OTP/promo detection, previously copy-pasted (with drifting keyword
 * lists) across every SMS parser. Also used as a cheap pre-check before the
 * AI fallback in import.service.ts, so a trusted sender's OTP/promo message
 * never triggers a wasted Anthropic API call.
 */
export const OTP_RE = /otp|verification|one-time|passcode|security\s*code|activate/i;
export const PROMO_RE = /promo|discount|offer|win|apply\s*now|customs|cashback|credit\s*card\s*offer|rewards/i;

export function isOtpMessage(message: string): boolean {
  return OTP_RE.test(message);
}

export function isPromoMessage(message: string): boolean {
  return PROMO_RE.test(message);
}

export function isOtpOrPromoMessage(message: string): boolean {
  return isOtpMessage(message) || isPromoMessage(message);
}
