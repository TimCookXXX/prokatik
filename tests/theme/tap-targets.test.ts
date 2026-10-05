import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import postcss, { type AtRule, type Node, type Rule } from "postcss";
import { filterChip } from "@/components/ui/filter-chip";

/* Сторож зон нажатия на тач-экране. Размеры живут в CSS и строках классов —
 * jsdom их не считает, ошибка видна только пальцем.
 *
 * CSS разбирается postcss, а классы — как множества: проверка не зависит от
 * пробелов, переносов и порядка классов в строке. */

const read = (file: string) => readFileSync(file, "utf8");
const css = postcss.parse(read("src/app/globals.css"));

const coarse = (node: Rule) => {
  for (let p: Node | undefined = node.parent; p; p = p.parent) {
    if (p.type === "atrule" && (p as AtRule).name === "media"
      && /\(\s*pointer\s*:\s*coarse\s*\)/.test((p as AtRule).params)) return true;
  }
  return false;
};

/** Объявления правил с этим селектором: под грубым указателем и вне его. */
function decls(selector: string) {
  const found = { coarse: new Map<string, string>(), other: new Map<string, string>() };
  css.walkRules((rule) => {
    if (!rule.selectors.map((s) => s.replace(/\s+/g, " ").trim()).includes(selector)) return;
    const into = coarse(rule) ? found.coarse : found.other;
    rule.walkDecls((d) => { into.set(d.prop, d.value.replace(/\s+/g, " ")); });
  });
  return found;
}

/** Строковые литералы файла (className="…" и строки в cn(…)) — множествами классов. */
const classSets = (file: string) =>
  [...read(file).matchAll(/"([^"\n]*)"/g)].map((m) => new Set(m[1].split(/\s+/).filter(Boolean)));

describe("цели для пальца", () => {
  // Расширение до 44px по каждой оси — и только на грубом указателе.
  it(".tap-target дотягивает зону до 44px на тач-экране", () => {
    const after = decls(".tap-target::after");
    expect(after.coarse.get("inset-block")).toBe("min(0px, calc((100% - 44px) / 2))");
    expect(after.coarse.get("inset-inline")).toBe("min(0px, calc((100% - 44px) / 2))");
    expect(decls(".tap-target").coarse.get("position")).toBe("relative");
    expect(after.other.size, "вне (pointer: coarse) зона расширяться не должна").toBe(0);
  });

  it("чипы фильтров и крестики шторок — с расширенной зоной", () => {
    expect(filterChip(false).split(/\s+/)).toContain("tap-target");
    expect(filterChip(true).split(/\s+/)).toContain("tap-target");
    for (const file of ["src/components/ui/Modal.tsx", "src/components/ui/Sheet.tsx"]) {
      const close = classSets(file).filter((c) => ["absolute", "right-3", "top-3"].every((k) => c.has(k)));
      expect(close.length, `${file}: крестик не найден`).toBeGreaterThan(0);
      for (const c of close) expect(c.has("tap-target"), file).toBe(true);
    }
  });

  // Стрелки месяцев — во всех календарях разом, через переменные библиотеки,
  // и только на тач-экране: мышь остаётся на размере библиотеки.
  it("стрелки месяцев в календарях — 44px только на тач-экране", () => {
    const nav = decls(".rdp-theme .rdp-root");
    expect(nav.coarse.get("--rdp-nav_button-height")).toBe("44px");
    expect(nav.coarse.get("--rdp-nav_button-width")).toBe("44px");
    expect(nav.other.has("--rdp-nav_button-height")).toBe(false);
    expect(nav.other.has("--rdp-nav_button-width")).toBe(false);
  });

  // Пункты меню стоят вплотную: невидимая зона перекрылась бы с соседней.
  it("пункты выпадающих меню на тач-экране — в рост пальца", () => {
    const sets = classSets("src/components/ui/dropdown-menu.tsx");
    expect(sets.some((c) => c.has("[@media(pointer:coarse)]:min-h-11"))).toBe(true);
  });
});
