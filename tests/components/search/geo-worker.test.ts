// @vitest-environment node
// Мини-индекс адресов в Web Worker (geo-worker.ts + address-client.ts): загрузка и сборка вне главного
// потока, подсказки по сообщениям, ответы по порядку; воркер упал — подсказки только с сервера.
// Worker подменён: сообщения передаются в тот же модуль воркера в этом процессе.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildClientIndex } from "@/lib/geocoder";
import { FIXTURE } from "../../geocoder/fixture";

type Handler = ((e: { data: unknown }) => void) | null;
const scope: { onmessage: Handler; postMessage: (m: unknown) => void } = { onmessage: null, postMessage: () => {} };
const created: FakeWorker[] = [];

class FakeWorker {
  onmessage: Handler = null;
  onerror: ((e: { message: string }) => void) | null = null;
  terminated = false;
  constructor(public url: URL, public opts?: WorkerOptions) {
    created.push(this);
    scope.postMessage = (m) => queueMicrotask(() => this.onmessage?.({ data: m }));
  }
  postMessage(m: unknown) {
    if (!this.terminated) queueMicrotask(() => scope.onmessage?.({ data: m }));
  }
  terminate() { this.terminated = true; }
}

const fetched: string[] = [];
beforeAll(async () => {
  vi.stubGlobal("self", scope);
  vi.stubGlobal("location", new URL("http://localhost:3000/krasnodar"));
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    fetched.push(url);
    return new Response(JSON.stringify(buildClientIndex(FIXTURE)), { status: 200 });
  }));
  await import("@/components/search/geo-worker");
});
afterAll(() => vi.unstubAllGlobals());

const { loadClientGeocoder } = await import("@/components/search/address-client");

describe("mini index in a Web Worker", () => {
  it("builds in the worker from an absolute URL and answers suggestions by message", async () => {
    const g = await loadClientGeocoder("krasnodar", "w1");
    expect(g).not.toBeNull();
    expect(created).toHaveLength(1);
    expect(String(created[0].url)).toContain("geo-worker.ts");
    // модульный воркер: Turbopack собирает его чанком со своего домена (CSP worker-src 'self')
    expect(created[0].opts).toEqual({ type: "module" });
    expect(fetched[0]).toMatch(/^http.*\/api\/geo\/client-index\?city=krasnodar&v=w1$/);
    const [a, b] = await Promise.all([g!.suggest("чукотск", { limit: 3 }), g!.suggest("ставропольск", { limit: 3 })]);
    expect(a?.[0].title).toBe("улица Чукотская");
    expect(b?.[0].title).toBe("улица Ставропольская");
    // один воркер на вкладку
    expect(await loadClientGeocoder("krasnodar", "w1")).toBe(g);
    expect(created).toHaveLength(1);
  });

  it("a worker that crashed answers null (the field falls back to the server) and is loaded anew next time", async () => {
    const g = await loadClientGeocoder("krasnodar", "w1");
    created[0].onerror?.({ message: "boom" });
    expect(await g!.suggest("чукотск")).toBeNull();
    const again = await loadClientGeocoder("krasnodar", "w1");
    expect(again).not.toBe(g);
    expect(created).toHaveLength(2);
  });
});
