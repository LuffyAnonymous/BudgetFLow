/**
 * tests/__mocks__/server-only.ts
 *
 * Empty mock for the `server-only` package used in Next.js.
 * In production Next.js builds, importing `server-only` throws if the file
 * is included in client bundles. In tests (vitest), we simply no-op it
 * since we're running in a Node.js environment, not a browser bundle.
 */
export {};
