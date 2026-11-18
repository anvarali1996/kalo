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
  // Do not log provider request bodies, photos, connection strings, or SDK objects.
  console.error("KALO scan/payment operation failed", error instanceof Error ? error.name : "UnknownError");
  return aiFail("aiServiceError", 503);
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
