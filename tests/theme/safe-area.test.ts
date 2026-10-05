import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/* Сторож геометрии нижней панели и системных инсетов.
 *
 * Всё это живёт строками классов и CSS-переменными: ни tsc, ни jsdom их не
 * считают, а ошибка видна только на телефоне — зазор под таб-баром, полоса
 * брони, наехавшая на панель, или кнопки под чёлкой. Поэтому проверка читает
 * исходники — тот же приём, что у сторожа высоты переписки по соседству. */

const read = (file: string) => readFileSync(file, "utf8");
const css = read("src/app/globals.css");

/** Значение custom property из первого блока, где она объявлена. */
function cssVar(name: string): string {
  const m = new RegExp(`${name}:\\s*([^;]+);`).exec(css);
  expect(m, `${name} не объявлена в globals.css`).not.toBeNull();
  return m![1].trim();
}

describe("safe-area", () => {
  // Без viewport-fit=cover iOS отдаёт env(safe-area-inset-*) нулями, и все
  // отступы под чёлку и полосу «домой» молча не работают.
  it("корневой viewport растянут под системные зоны", () => {
    expect(read("src/app/layout.tsx")).toMatch(/viewportFit:\s*"cover"/);
  });

  // HeaderSearch складывает их через parseFloat: env() или calc() там дали бы NaN.
  it("--header-h и --header-inset — голые числа в px", () => {
    expect(cssVar("--header-h")).toMatch(/^\d+px$/);
    expect(cssVar("--header-inset")).toMatch(/^\d+px$/);
  });

  it("--header-total учитывает верхний инсет, и шапка на него отступает", () => {
    expect(cssVar("--safe-top")).toBe("env(safe-area-inset-top)");
    expect(cssVar("--header-total")).toContain("var(--safe-top)");
    expect(read("src/components/layout/Header.tsx")).toContain("pt-[var(--safe-top)]");
  });

  /* Fixed-слой во всю ширину отступы body не наследует: у телефона на боку его
   * края уходят под чёлку. Каждый такой слой обязан отступить от инсетов сам. */
  it("fixed-слои во всю ширину отступают от боковых инсетов", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx$/.test(name)) files.push(path);
      }
    };
    walk("src");

    const layers = files.filter((f) => /\bfixed inset-x-0\b|max-md:fixed max-md:inset-x-0/.test(read(f)));
    expect(layers.length).toBeGreaterThan(0);
    for (const file of layers) {
      const src = read(file);
      expect(src, `${file}: нет отступа от левого инсета`).toContain("safe-area-inset-left");
      expect(src, `${file}: нет отступа от правого инсета`).toContain("safe-area-inset-right");
    }
  });
});

describe("таб-бар", () => {
  const tabbar = read("src/components/layout/TabBar.tsx");

  /* --tabbar-h — точная высота панели: на ней висят отступ подвала и полоса
   * брони над панелью. Кант 1px + строка h-14 (56px) + полоса «домой». Разойдись
   * число с разметкой — подвал уедет под панель или над ней встанет щель. */
  it("--tabbar-h равна канту, строке иконок и полосе «домой»", () => {
    expect(cssVar("--tabbar-h")).toBe("calc(57px + env(safe-area-inset-bottom))");
    expect(tabbar).toMatch(/data-tabbar[\s\S]*?className="[^"]*\bborder-t\b/);
    expect(tabbar).toMatch(/className="[^"]*\bflex h-14\b/);
    expect(tabbar).toContain("pb-[env(safe-area-inset-bottom)]");
  });
});
