// @vitest-environment node
// У каждой формы сайта своё имя: без него Метрика («Аналитика форм», автоцель
// «Отправка формы») их не различает. Новая форма без name валит тест.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "../../../src");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : []);
}

/**
 * Открывающие теги <form …> со всеми атрибутами, в том числе многострочные.
 * Конец тега — `>` вне фигурных скобок: внутри них бывает `=>` обработчика.
 */
function forms(): { file: string; tag: string }[] {
  return walk(SRC).flatMap((file) => {
    const text = readFileSync(file, "utf8");
    return [...text.matchAll(/<form\b/g)].map((m) => {
      let depth = 0;
      let end = m.index;
      for (; end < text.length; end++) {
        const ch = text[end];
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        else if (ch === ">" && depth === 0) break;
      }
      return { file: relative(SRC, file), tag: text.slice(m.index, end + 1) };
    });
  });
}

describe("имена форм", () => {
  it("у каждой <form> есть name", () => {
    const unnamed = forms().filter((f) => !/\bname="[a-z_]+"/.test(f.tag)).map((f) => f.file);
    expect(unnamed).toEqual([]);
  });

  it("имена — из списка и не повторяются", () => {
    const names = forms().map((f) => /\bname="([a-z_]+)"/.exec(f.tag)?.[1]);
    expect([...names].sort()).toEqual([
      "admin_category", "admin_city", "admin_visitor_find", "analytics_opt_out", "auth_email", "banned", "booking", "booking_lead", "filters", "listing",
      "password_change", "password_reset", "profile", "search_header", "search_hero", "search_mobile",
    ]);
  });
});
