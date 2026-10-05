import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

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
   * края уходят под чёлку. Слой во всю ширину (inset-x-0) обязан отступить от
   * инсетов сам. Полноэкранный слой (inset-0) — либо так же, либо его кнопки,
   * прижатые абсолютом к левому или правому краю, отступают от инсета каждая.
   *
   * Классы собираются по элементу через AST, а не регэкспом по строке: так
   * ловится любой порядок классов и класс, разнесённый по нескольким строкам
   * cn(…) или по константе. */
  it("fixed-слои во всю ширину отступают от боковых инсетов", () => {
    const layers = fixedLayers();
    expect(layers.length).toBeGreaterThan(0);
    for (const l of layers) {
      const left = l.classes.some((c) => c.includes("safe-area-inset-left"));
      const right = l.classes.some((c) => c.includes("safe-area-inset-right"));
      if (l.kind === "x") {
        expect(left, `${l.where}: нет отступа от левого инсета`).toBe(true);
        expect(right, `${l.where}: нет отступа от правого инсета`).toBe(true);
      } else if (!(left && right)) {
        for (const c of l.edgeControls) {
          expect(c.edge, `${l.where}: ${c.where} прижат к краю без отступа от инсета`).toContain("safe-area-inset-");
        }
      }
    }
  });
});

interface Layer {
  where: string;
  kind: "x" | "full";
  classes: string[];
  edgeControls: { where: string; edge: string }[];
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.tsx$/.test(name)) out.push(path);
  }
  return out;
}

/** Все классы из строковых литералов под узлом (обе ветки тернарника тоже). */
function classesUnder(node: ts.Node): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n)
      || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      out.push(...n.text.split(/\s+/).filter(Boolean));
    }
    n.forEachChild(visit);
  };
  visit(node);
  return out;
}

/** Вид fixed-слоя: на всю ширину, на весь экран или не растянутый. */
function layerKind(classes: string[]): Layer["kind"] | null {
  const byVariant = new Map<string, Set<string>>();
  for (const c of classes) {
    const i = c.lastIndexOf(":");
    const v = i < 0 ? "" : c.slice(0, i);
    if (!byVariant.has(v)) byVariant.set(v, new Set());
    byVariant.get(v)!.add(c.slice(i + 1));
  }
  for (const u of byVariant.values()) {
    if (!u.has("fixed")) continue;
    if (u.has("inset-0")) return "full";
    if (u.has("inset-x-0") || (u.has("left-0") && u.has("right-0"))) return "x";
  }
  return null;
}

/** Прижатие к левому/правому краю: left-3, right-4, right-[…]; не left-1/2. */
const EDGE = /^(left|right)-(\d+(\.\d+)?|px|\[.+\])$/;

function fixedLayers(): Layer[] {
  const layers: Layer[] = [];
  for (const file of sourceFiles("src")) {
    const sf = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const at = (n: ts.Node) => `${file}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
    const ownClasses = (el: ts.JsxOpeningLikeElement) => {
      const attr = el.attributes.properties.find(
        (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === "className",
      );
      return attr?.initializer ? classesUnder(attr.initializer) : [];
    };
    const visit = (n: ts.Node) => {
      // Константа со строкой классов (PANEL_MOBILE в ChatPanes и подобные).
      if (ts.isVariableDeclaration(n) && n.initializer && !ts.isArrowFunction(n.initializer)
        && !ts.isFunctionExpression(n.initializer)) {
        const classes = classesUnder(n.initializer);
        const kind = layerKind(classes);
        if (kind) layers.push({ where: at(n), kind, classes, edgeControls: [] });
      }
      if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
        const classes = ownClasses(n);
        const kind = layerKind(classes);
        if (kind) {
          const edgeControls: Layer["edgeControls"] = [];
          if (ts.isJsxOpeningElement(n)) {
            const inner = (m: ts.Node) => {
              if (ts.isJsxOpeningElement(m) || ts.isJsxSelfClosingElement(m)) {
                const cs = ownClasses(m);
                if (cs.includes("absolute")) {
                  for (const c of cs) if (EDGE.test(c)) edgeControls.push({ where: at(m), edge: c });
                }
              }
              m.forEachChild(inner);
            };
            n.parent.forEachChild((child) => { if (child !== n) inner(child); });
          }
          layers.push({ where: at(n), kind, classes, edgeControls });
        }
      }
      n.forEachChild(visit);
    };
    visit(sf);
  }
  return layers;
}

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

describe("полоса брони на карточке вещи", () => {
  const widget = read("src/components/booking/BookingWidget.tsx");

  // Две нижние панели друг на друге съедали низ экрана: на карточке чужой
  // вещи остаётся одна — полоса брони.
  it("прячет таб-бар по маркеру полосы", () => {
    expect(css).toMatch(/html:has\(\[data-booking-bar\]\) \[data-tabbar\]\s*\{\s*display:\s*none;/);
  });

  // Высота полосы — кант 1px + строка h-16 (64px) + полоса «домой». Подвал
  // отступает на неё, а не на высоту спрятанного таб-бара.
  it("--bottom-bar-h равна высоте полосы, и подвал отступает на неё", () => {
    expect(css).toMatch(
      /html:has\(\[data-booking-bar\]\)\s*\{\s*--bottom-bar-h:\s*calc\(65px \+ env\(safe-area-inset-bottom\)\);/,
    );
    expect(widget).toMatch(/data-booking-bar[\s\S]*?border-t[\s\S]*?className="[^"]*\bflex h-16\b/);
    expect(read("src/app/layout.tsx")).toContain("pb-[var(--bottom-bar-h)]");
  });

  // Полоса больше не верхний ярус таб-бара — снимать ему скругления незачем.
  it("хака со скруглениями таб-бара больше нет", () => {
    expect(css).not.toMatch(/\[data-tabbar\]\s*>\s*div/);
  });
});
