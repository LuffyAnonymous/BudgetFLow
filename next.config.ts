import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

/**
 * Content Security Policy configuration.
 *
 * Allowed sources are documented per directive:
 *
 * script-src:
 *   - 'self': Next.js page bundles
 *   - 'unsafe-inline': required for Next.js inline hydration scripts (App Router)
 *   - 'unsafe-eval': required by Next.js in development (hot-reload); omitted in production
 *
 * style-src:
 *   - 'self': CSS modules
 *   - 'unsafe-inline': required for styled-components / CSS-in-JS runtime (Recharts)
 *   - fonts.googleapis.com: Google Fonts CSS
 *
 * font-src:
 *   - fonts.gstatic.com: Google Fonts binary assets
 *
 * img-src:
 *   - 'self': app images
 *   - data: base64 data URIs (Recharts SVG rendering)
 *   - blob: PDF/image object URLs (attachment preview)
 *   - *.amazonaws.com: S3-hosted attachment thumbnails
 *   - *.r2.cloudflarestorage.com: R2-hosted attachments
 *
 * connect-src:
 *   - 'self': API routes and Next.js HMR
 *   - ws://localhost:*: Next.js hot-reload WebSocket (dev only)
 *
 * frame-ancestors:
 *   - 'none': Prevents clickjacking. X-Frame-Options is also set as defense-in-depth.
 *
 * object-src / base-uri:
 *   - 'none': Prevents plugin embedding and base tag injection.
 */
const cspDirectives = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
  `font-src 'self' https://fonts.gstatic.com`,
  `img-src 'self' data: blob: https://*.amazonaws.com https://*.r2.cloudflarestorage.com`,
  `connect-src 'self'${isProd ? "" : " ws://localhost:*"}`,
  `frame-src 'none'`,
  `frame-ancestors 'none'`,
  `object-src 'none'`,
  `base-uri 'none'`,
  `form-action 'self'`,
  `upgrade-insecure-requests`,
];

const cspHeader = cspDirectives.join("; ");

const securityHeaders = [
  // Prevents MIME-type sniffing attacks
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Defense-in-depth framing protection alongside frame-ancestors CSP
  { key: "X-Frame-Options", value: "DENY" },
  // Stops browser from sending full referrer URL to third parties
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Disable browser features not needed by a finance app
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=()",
  },
  // HSTS: only enable in production over HTTPS
  // max-age = 1 year (31536000 seconds), includeSubDomains
  ...(isProd
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
  // Content Security Policy
  { key: "Content-Security-Policy", value: cspHeader },
];

const nextConfig: NextConfig = {
  // @aws-sdk/client-s3 is a production-only dep loaded at runtime by the server.
  // Adding it here prevents Next.js from attempting to bundle it for the browser.
  serverExternalPackages: ["@aws-sdk/client-s3"],

  async headers() {
    return [
      {
        // Apply security headers to all routes
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
