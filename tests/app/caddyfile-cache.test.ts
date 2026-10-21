// @vitest-environment node
// Cache-Control, который ставит Caddy, заменяет заголовок Next, а не
// дописывается к нему вторым: без defer reverse_proxy добавляет заголовок app к
// уже выставленному, и ответ уходит с двумя Cache-Control.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const caddyfile = readFileSync(resolve(__dirname, "../../Caddyfile"), "utf8");

/** Директивы header с Cache-Control: однострочные и блоки. */
function cacheHeaders(): { matcher: string; text: string }[] {
  const out: { matcher: string; text: string }[] = [];
  for (const m of caddyfile.matchAll(/^\s*header\s+(@\w+)\s*(\{[^}]*\}|[^\n]*)/gm)) {
    if (/Cache-Control/.test(m[2])) out.push({ matcher: m[1], text: m[2] });
  }
  return out;
}

describe("Caddyfile: Cache-Control", () => {
  it("задаётся для статики и иконок", () => {
    expect(cacheHeaders().map((h) => h.matcher).sort()).toEqual(["@icons", "@static"]);
  });

  it.each(cacheHeaders())("$matcher — с defer, заменой заголовка app", ({ text }) => {
    expect(/^\{[\s\S]*^\s*defer\s*$/m.test(text) || /^\s*>Cache-Control/m.test(text)).toBe(true);
  });
});
