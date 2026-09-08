/**
 * Read a response clone while enforcing an inclusive byte limit.
 *
 * @param response - A clone whose body may be consumed or cancelled.
 * @param maxBytes - Maximum retained response bytes, validated by the caller.
 * @returns Captured bytes, or null as soon as the stream exceeds the limit.
 *   Cancelling a tee branch is not awaited because the other branch may still
 *   be waiting for its consumer. The original response remains readable.
 * @throws Propagates stream read errors without converting them to cached data.
 * @internal
 */
export async function readResponseBodyUpTo(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array | null> {
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        void reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (chunks.length === 1) return chunks[0]!;
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
