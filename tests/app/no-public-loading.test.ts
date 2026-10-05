// @vitest-environment node
// Каталог (/{city}/…) рендерится без Suspense-границы над страницей: с
// loading.tsx ответ начинает стримиться до notFound() и permanentRedirect(), и
// робот получает 200 с meta refresh вместо настоящих 404 и 308
// (docs/decisions/0024-no-loading-boundary-in-public-catalog.md).
import { existsSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const APP = resolve(__dirname, "../../src/app");
const CATALOG = join(APP, "(public)/[city]");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
}

describe("публичный каталог", () => {
  it("не содержит loading.tsx ни на одном уровне", () => {
    const files = walk(CATALOG);
    expect(files.some((f) => f.endsWith("page.tsx"))).toBe(true);
    const loading = files.filter((f) => /\/loading\.(t|j)sx?$/.test(f)).map((f) => relative(CATALOG, f));
    expect(loading).toEqual([]);
  });

  it("и выше по дереву: loading.tsx корня и группы (public) накрыл бы каталог", () => {
    const above = ["", "(public)"].flatMap((dir) =>
      ["tsx", "ts", "jsx", "js"].map((ext) => join(APP, dir, `loading.${ext}`)));
    expect(above.filter((f) => existsSync(f)).map((f) => relative(APP, f))).toEqual([]);
  });
});
