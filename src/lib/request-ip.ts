/**
 * src/lib/request-ip.ts
 *
 * Shared client-IP extraction for rate limiting. Vercel (and most proxies)
 * set x-forwarded-for; the first entry is the original client.
 */

export function getClientIp(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
