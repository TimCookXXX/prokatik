// @vitest-environment node
// Тело с потолком: Content-Length не единственная защита — поток без него
// читается с отсечкой.
import { describe, expect, it } from "vitest";
import { readBodyCapped } from "@/lib/http/read-capped";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let pulled = 0;
  return new ReadableStream({
    pull(controller) {
      if (pulled >= chunks.length) return controller.close();
      controller.enqueue(enc.encode(chunks[pulled++]));
    },
  });
}

const req = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request("http://x/", { method: "POST", body, headers, duplex: "half" } as RequestInit);

describe("readBodyCapped", () => {
  it("тело в пределах — строкой", async () => {
    expect(await readBodyCapped(req("привет"), 100)).toBe("привет");
  });

  it("заявленный размер больше потолка — не читается", async () => {
    expect(await readBodyCapped(req("x", { "content-length": "101" }), 100)).toBeNull();
  });

  it("поток без длины обрывается на потолке", async () => {
    const pulls: string[] = Array.from({ length: 1000 }, () => "a".repeat(50));
    expect(await readBodyCapped(req(streamOf(pulls)), 120)).toBeNull();
  });

  it("битый UTF-8 — отказ", async () => {
    expect(await readBodyCapped(req(new Uint8Array([0xff, 0xfe, 0xfd])), 100)).toBeNull();
  });
});
