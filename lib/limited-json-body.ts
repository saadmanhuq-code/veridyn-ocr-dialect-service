/** Bound dialect-route JSON input before parsing; Content-Length is only an early hint. */
export const MAX_DIALECT_REQUEST_BYTES = 65_536;

export class JsonBodyTooLargeError extends Error {
  constructor() {
    super(`JSON body exceeds ${MAX_DIALECT_REQUEST_BYTES} bytes.`);
    this.name = "JsonBodyTooLargeError";
  }
}

export async function parseLimitedJsonBody(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_DIALECT_REQUEST_BYTES) {
    throw new JsonBodyTooLargeError();
  }
  if (!request.body) throw new SyntaxError("Expected JSON body");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_DIALECT_REQUEST_BYTES) {
        await reader.cancel();
        throw new JsonBodyTooLargeError();
      }
      chunks.push(value);
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
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}
