/**
 * 2140.wtf error codes — a stable, machine-readable code for every user-facing
 * failure, paired with a graceful human message.
 *
 * Why codes: a wall of stack-jargon ("Fetch failed", "TypeError: …") helps
 * nobody. Every surfaced error instead carries a short code (e.g. `UPLOAD_001`)
 * the user can quote and we can look up. The codes are documented in the
 * in-app `help` and this file is the single source of truth for their text.
 *
 * Use `baoError(code)` to throw one, and `describeError(error)` to render the
 * friendly message (+ code) for display.
 */

export const ErrorCodes = {
  // Uploads (Blossom)
  UPLOAD_NOT_LOGGED_IN: "UPLOAD_001",
  UPLOAD_NO_SERVERS: "UPLOAD_002",
  UPLOAD_FAILED: "UPLOAD_003",
  UPLOAD_TIMEOUT: "UPLOAD_004",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/** Friendly, jargon-free message + optional hint per code. */
const MESSAGES: Record<string, { message: string; hint?: string }> = {
  UPLOAD_001: {
    message: "You need to be signed in to attach files.",
    hint: "Sign in, then try again.",
  },
  UPLOAD_002: {
    message: "No file server is configured, so the attachment couldn't be sent.",
    hint: "Add a file server in Settings, or wait a moment and retry.",
  },
  UPLOAD_003: {
    message: "The file server couldn't accept the attachment right now.",
    hint: "Please try again in a few seconds.",
  },
  UPLOAD_004: {
    message: "The file server took too long to respond.",
    hint: "Check your connection and try again.",
  },
};

/** An error that carries a stable, documented code. */
export interface BaoError extends Error {
  code: ErrorCode;
}

/** Throw (or return) an error with a stable code. */
export function baoError(code: ErrorCode, detail?: string): BaoError {
  const { message } = MESSAGES[code] ?? { message: "Something went wrong." };
  const err = new Error(detail ? `${message} (${detail})` : message) as BaoError;
  err.code = code;
  return err;
}

/** Read a stable code off any thrown value, if it has one. */
export function errorCodeOf(e: unknown): ErrorCode | undefined {
  return typeof e === "object" && e !== null && "code" in e ? (e as BaoError).code : undefined;
}

/** Render a graceful user-facing description for any error: friendly message
 *  plus the code. Falls back to a generic line for non-coded errors. */
export function describeError(e: unknown): { message: string; code?: string } {
  const code = errorCodeOf(e);
  if (code) {
    const m = MESSAGES[code];
    return { message: m?.message ?? "Something went wrong.", code };
  }
  if (e instanceof Error && e.message) return { message: e.message };
  return { message: "Something went wrong." };
}

/** A line documenting a code, for the in-app help section. */
export function errorCodeDocs(): string {
  const lines = Object.entries(MESSAGES)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, { message, hint }]) => `  ${code}: ${message}${hint ? ` — ${hint}` : ""}`);
  return lines.join("\n");
}
