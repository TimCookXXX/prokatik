// Тело запроса с потолком размера. Content-Length проверяется первым, но ему
// верить нельзя (его может не быть, а chunked-тело его не обещает), поэтому
// поток читается с отсечкой: сверх потолка чтение обрывается, и в память не
// ложится больше `max` байт.

/** Тело строкой; null — больше потолка или не прочиталось. */
export async function readBodyCapped(req: Request, max: number): Promise<string | null> {
  const declared = req.headers.get("content-length");
  if (declared !== null && !(Number(declared) <= max)) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(all);
  } catch {
    return null;
  }
}
