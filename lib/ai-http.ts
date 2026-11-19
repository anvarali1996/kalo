import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class AiError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}

export function aiFail(code: string, status = 400) {
  return NextResponse.json({ error: code }, { status, headers: { "Cache-Control": "no-store" } });
}

export function aiHandleError(error: unknown) {
  if (error instanceof AiError) return aiFail(error.code, error.status);
  if (error instanceof ZodError || error instanceof SyntaxError) return aiFail("aiInvalidInput");
  const dbCode = databaseErrorCode(error);
  // Do not log provider request bodies, photos, connection strings, or SDK objects.
  console.error("KALO scan/payment operation failed", dbCode ?? (error instanceof Error ? error.name : "UnknownError"));
  if (dbCode && ["42P01", "42703", "42883", "P0002"].includes(dbCode)) return aiFail("aiStorageUnavailable", 503);
  return aiFail("aiServiceError", 503);
}

function databaseErrorCode(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    if ("code" in current && typeof current.code === "string" && /^[\dA-Z]{5}$/.test(current.code)) return current.code;
    current = "cause" in current ? current.cause : undefined;
  }
}

/** Bound streamed bodies, even when Content-Length is missing or incorrect. */
export async function limitedBody(req: Request, limit: number): Promise<string> {
  if (Number(req.headers.get("content-length") || 0) > limit) throw new AiError("aiPhotoTooLarge", 413);
  const reader = req.body?.getReader();
  if (!reader) throw new AiError("aiInvalidInput");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new AiError("aiPhotoTooLarge", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}

export const privateJson = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
