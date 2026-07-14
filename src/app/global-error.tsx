"use client";

import { useEffect } from "react";
import { LucideAlertTriangle, LucideRefreshCw } from "lucide-react";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Root-level error boundary.
 * Catches errors that escape the (dashboard) error.tsx boundary,
 * including errors in the root layout itself.
 * Must include its own <html> and <body> tags.
 */
export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error("[GlobalError]", error.digest ?? "(no digest)", error.message);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          backgroundColor: "#0a0f1e",
          color: "#e2e8f0",
          fontFamily: "system-ui, -apple-system, sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
        }}
      >
        <div
          role="alert"
          aria-live="assertive"
          style={{ maxWidth: 480, width: "100%", textAlign: "center", padding: 32 }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              background: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgba(239, 68, 68, 0.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 24px",
            }}
          >
            <LucideAlertTriangle
              style={{ width: 28, height: 28, color: "#f87171" }}
              aria-hidden="true"
            />
          </div>

          <h1 style={{ fontSize: 24, fontWeight: 700, color: "#fff", marginBottom: 12 }}>
            Application error
          </h1>
          <p style={{ fontSize: 14, color: "#94a3b8", lineHeight: 1.6, marginBottom: 8 }}>
            A critical error occurred. Please reload the page.
            If the problem persists, contact support.
          </p>
          {error.digest && (
            <p style={{ fontSize: 11, color: "#475569", fontFamily: "monospace", marginBottom: 24 }}>
              Reference: {error.digest}
            </p>
          )}

          <button
            onClick={reset}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: "#4f46e5",
              color: "#fff",
              border: "none",
              borderRadius: 12,
              padding: "10px 20px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <LucideRefreshCw style={{ width: 16, height: 16 }} aria-hidden="true" />
            Reload page
          </button>
        </div>
      </body>
    </html>
  );
}
