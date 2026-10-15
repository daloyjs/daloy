/**
 * Bounded request-body reader for the site's public POST endpoints.
 *
 * `request.text()` / `request.arrayBuffer()` buffer the whole body before the
 * caller can check its size, so a chunked request (no `Content-Length`) could
 * make the function hold an arbitrarily large payload in memory. This reader
 * refuses on the declared length first, then streams the body and cancels it
 * as soon as the running total passes the cap.
 */

/** Outcome of {@link readBodyLimited}. */
export type LimitedBody =
  | { readonly ok: true; readonly bytes: Uint8Array<ArrayBuffer> }
  | { readonly ok: false };

/**
 * Read a request body, refusing anything larger than `maxBytes`.
 *
 * @param request - The inbound request; its body is consumed.
 * @param maxBytes - Inclusive byte cap.
 * @returns `{ ok: true, bytes }` within the cap, or `{ ok: false }` when the
 *   declared `Content-Length` or the bytes actually received exceed it (the
 *   stream is cancelled, so no further bytes are buffered).
 */
export async function readBodyLimited(
  request: Request,
  maxBytes: number,
): Promise<LimitedBody> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false };
  if (request.body === null) return { ok: true, bytes: new Uint8Array(0) };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}
