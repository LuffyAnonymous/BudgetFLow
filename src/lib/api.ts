import { NextResponse } from "next/server";

export interface ApiResponse<T = unknown> {
  data: T | null;
  error: {
    code: string;
    message: string;
  } | null;
}

/**
 * Returns a uniform success response.
 */
export function apiSuccess<T>(data: T, status = 200) {
  return NextResponse.json<ApiResponse<T>>(
    { data, error: null },
    { status }
  );
}

/**
 * Returns a uniform error response.
 */
export function apiError(code: string, message: string, status = 400) {
  return NextResponse.json<ApiResponse<null>>(
    { data: null, error: { code, message } },
    { status }
  );
}

/**
 * Catch and parse internal exceptions, returning safe user-facing errors.
 */
export function handleApiError(error: unknown) {
  console.error("API Error:", error);
  
  const rawMessage = error instanceof Error ? error.message : "An unexpected error occurred.";
  
  // General format parsing for "CODE: message" thrown by services
  if (rawMessage.includes(": ")) {
    const idx = rawMessage.indexOf(": ");
    const code = rawMessage.substring(0, idx);
    const msg = rawMessage.substring(idx + 2);
    const isNotFound = code.includes("NOT_FOUND");
    return apiError(code, msg, isNotFound ? 404 : 400);
  }
  
  if (rawMessage.includes("Invalid month format") || rawMessage.includes("Month is required")) {
    return apiError("INVALID_MONTH", rawMessage, 400);
  }
  
  // Mask Prisma or raw database errors
  return apiError(
    "INTERNAL_ERROR",
    "An unexpected error occurred. Please contact support or try again later.",
    500
  );
}
