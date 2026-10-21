// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseCookie } from "cookie";
import { ANALYTICS_ALLOWED_JS, analyticsAllowed } from "@/lib/analytics/allowed";

// Переключатель учёта один, но живёт в двух видах: функцией и JS-выражением
// для инлайн-сниппета Метрики. Разойдись они — отказ выключил бы свою
// статистику и оставил Метрику, или наоборот.

const fromHeader = (header: string) => {
  const jar = parseCookie(header);
  return analyticsAllowed((name) => jar[name]);
};
const fromSnippet = (cookie: string): boolean =>
  new Function("document", `return ${ANALYTICS_ALLOWED_JS};`)({ cookie });

const CASES: [string, boolean][] = [
  ["", true],
  ["city=krasnodar", true],
  ["noanalytics=1", false],
  ["city=krasnodar; noanalytics=1", false],
  ["noanalytics=1; city=krasnodar", false],
  ["noanalytics=0", true],
  ["noanalytics=10", true],
  ["xnoanalytics=1", true],
  ["noanalyticsx=1", true],
];

describe("analyticsAllowed", () => {
  it.each(CASES)("cookie «%s» → учёт %s", (header, allowed) => {
    expect(fromHeader(header)).toBe(allowed);
  });

  it.each(CASES)("сниппет решает так же: «%s»", (header, allowed) => {
    expect(fromSnippet(header)).toBe(allowed);
  });
});
