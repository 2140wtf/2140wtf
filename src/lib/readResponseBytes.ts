/**
 * Read an HTTP response body with a hard byte limit.
 *
 * Content-Length is checked when available, but it is not trusted as the only
 * guard because chunked responses may omit it. Streaming responses are counted
 * as they arrive and buffered responses are checked after reading.
 */
export async function readResponseBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new Error('Invalid response size limit');
  }

  const declaredLength = Number(response.headers?.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`Response exceeds the ${maxBytes}-byte limit`);
  }

  if (!response.body) {
    const bytes = typeof response.arrayBuffer === 'function'
      ? new Uint8Array(await response.arrayBuffer())
      : new TextEncoder().encode(await response.text());
    if (bytes.byteLength > maxBytes) {
      throw new Error(`Response exceeds the ${maxBytes}-byte limit`);
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`Response exceeds the ${maxBytes}-byte limit`);
      }
      chunks.push(new Uint8Array(value));
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
