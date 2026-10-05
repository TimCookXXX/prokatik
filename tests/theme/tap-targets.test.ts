import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { filterChip } from "@/components/ui/filter-chip";

/* Сторож зон нажатия на тач-экране. Размеры живут в CSS и строках классов —
 * jsdom их не считает, ошибка видна только пальцем. */

const read = (file: string) => readFileSync(file, "utf8");
const css = read("src/app/globals.css");

describe("цели для пальца", () => {
  // Расширение до 44px по каждой оси — и только на грубом указателе.
  it(".tap-target дотягивает зону до 44px на тач-экране", () => {
    const rule = /@media \(pointer: coarse\)\s*\{\s*\.tap-target \{ position: relative; \}\s*\.tap-target::after \{([^}]+)\}/.exec(css);
    expect(rule, ".tap-target не найден под (pointer: coarse)").not.toBeNull();
    expect(rule![1]).toContain("inset-block: min(0px, calc((100% - 44px) / 2))");
    expect(rule![1]).toContain("inset-inline: min(0px, calc((100% - 44px) / 2))");
  });

  it("чипы фильтров и крестики шторок — с расширенной зоной", () => {
    expect(filterChip(false).split(" ")).toContain("tap-target");
    expect(filterChip(true).split(" ")).toContain("tap-target");
    for (const file of ["src/components/ui/Modal.tsx", "src/components/ui/Sheet.tsx"]) {
      expect(read(file), file).toMatch(/className="tap-target absolute right-3 top-3/);
    }
  });

  // Стрелки месяцев — во всех календарях разом, через переменные библиотеки.
  it("стрелки месяцев в календарях — 44px", () => {
    expect(css).toContain("--rdp-nav_button-height: 44px;");
    expect(css).toContain("--rdp-nav_button-width: 44px;");
  });

  // Пункты меню стоят вплотную: невидимая зона перекрылась бы с соседней.
  it("пункты выпадающих меню на тач-экране — в рост пальца", () => {
    expect(read("src/components/ui/dropdown-menu.tsx")).toContain("[@media(pointer:coarse)]:min-h-11");
  });
});
