import { describe, expect, it } from "vitest";
import { completeQuery, pickCompletions, MAX_EVALUATED } from "@/lib/search/complete";
import { rankListings, rankResults, suggestCategories } from "@/lib/search/listing-index";
import { ROWS, fixtureIndex, type FixtureListing } from "./fixture";

// Подсказки «Что» — дополнение запроса (docs/decisions/0023): последнее слово
// дописывается словами заголовков тех объявлений, которые находят набранные
// слова перед ним.
const ix = fixtureIndex();
const complete = (q: string, index = ix) => completeQuery(index, q, { resultsLimit: 1000 });
const texts = (q: string, index = ix) => complete(q, index).map((c) => c.text);

describe("completeQuery", () => {
  it.each([
    ["перф", "перфоратор"],
    ["перфоратор мак", "перфоратор makita"],
    ["перфоратор makita hr", "перфоратор makita hr2470"],
    ["перфоратор макита", "перфоратор makita"],
    ["gthajhfnjh", "перфоратор"],
    ["керх", "karcher"],
  ])("«%s» → «%s»", (q, expected) => {
    expect(texts(q)[0]).toBe(expected);
  });

  it("shows the spelling sellers use, with ё", () => {
    expect(texts("шурупов")).toEqual(["шуруповёрт"]);
  });

  it("keeps the typed words as typed", () => {
    expect(texts("Перфоратор   Мак")).toEqual(["перфоратор makita"]);
    expect(texts("gthajhfnjh мак")).toEqual(["gthajhfnjh makita"]);
  });

  it("completes the last word only from titles of what the typed words find", () => {
    // «makita» есть и у шуруповёрта, и у УШМ, но после «перфоратор» — только одно.
    expect(texts("перфоратор ma")).toEqual(["перфоратор makita"]);
    expect(texts("шуруповерт ma")).toEqual(["шуруповерт makita"]);
  });

  it("takes title words only — not section names or descriptions", () => {
    // «электроинструменты» — раздел перфоратора, «бетону» — его описание.
    expect(texts("перфоратор эле")).toEqual([]);
    expect(texts("перфоратор бет")).toEqual([]);
  });

  it("falls back to typos only when no word starts with the input", () => {
    expect(texts("перфаратор")).toEqual(["перфоратор"]);
    // «палатк» находит «палатку» по началу — «платье» опечаткой не предлагается.
    expect(texts("палатк")).toEqual(["палатка"]);
  });

  // Яблоновский: палаток нет, перфораторы есть (docs/decisions/0023).
  describe("typos in the panel: a whole word with the same first two letters", () => {
    const noTents = fixtureIndex(ROWS.filter((r) => !/палатк/i.test(r.title)));
    const sections = (q: string) => suggestCategories(noTents, q).map((c) => c.category.name);

    it("«палат» does not become «платье» when there are no tents", () => {
      expect(texts("палат", noTents)).toEqual([]);
      expect(texts("палат ", noTents)).toEqual([]);
      expect(texts("палат вечер", noTents)).toEqual([]);
      expect(sections("палат")).toEqual([]);
      // Выдача прежняя: там это опечатка, и она находит платья.
      expect(rankListings(noTents, "палат", { mode: "results", limit: 10 }).some((h) => /платье/i.test(h.row.title))).toBe(true);
    });

    it("«перф» completes to «перфоратор» and does not suggest «Водный спорт» (≈ «серфинг»)", () => {
      expect(texts("перф", noTents)).toEqual(["перфоратор"]);
      expect(sections("перф")).not.toContain("Водный спорт");
      expect(sections("серф")).toContain("Водный спорт");
    });

    it("a whole word with a typo still completes", () => {
      expect(texts("перфаратор", noTents)).toEqual(["перфоратор"]);
      expect(texts("перфаратор мак", noTents)).toEqual(["перфаратор makita"]);
    });
  });

  it("a trailing piece without letters is not completed", () => {
    expect(texts("перфоратор -")).toEqual(["перфоратор"]);
  });

  it("never completes by a substring", () => {
    expect(texts("ратор")).not.toContain("перфоратор");
  });

  it("merges word forms into one suggestion", () => {
    const rows: FixtureListing[] = [
      ...ROWS,
      { ...ROWS[0], id: "X1", title: "Перфоратора набор", createdAt: new Date("2026-03-01") },
    ];
    expect(texts("перфо", fixtureIndex(rows))).toEqual(["перфоратор"]);
  });

  it("does not offer numbers, units, prepositions, stop words or city names", () => {
    expect(texts("болгарка dewalt 1")).toEqual([]);
    expect(texts("болгарка dewalt м")).toEqual([]);
    expect(texts("генератор бензиновый 3 кв")).toEqual([]);
    const rows: FixtureListing[] = [
      ...ROWS,
      { ...ROWS[0], id: "X1", title: "Палатка под заказ Краснодар прокат", createdAt: new Date("2026-03-01") },
    ];
    const city = fixtureIndex(rows);
    expect(texts("палатка по", city)).toEqual([]);
    expect(texts("палатка кра", city)).toEqual([]);
    expect(texts("палатка прок", city)).toEqual([]);
  });

  it("offers a model article or a rare Latin name only after a typed word", () => {
    // Первым словом — ни артикул, ни бренд из одного заголовка.
    expect(texts("hr")).toEqual([]);
    expect(texts("tre")).toEqual([]);
    // После набранного слова — да: человек дописывает конкретную вещь.
    expect(texts("велосипед tre")).toEqual(["велосипед trek"]);
    // Латиница и короткие слова из синонимов — не мусор и первым словом.
    expect(texts("plays")).toEqual(["playstation"]);
    const vr = fixtureIndex([...ROWS, { ...ROWS[0], id: "X1", title: "Шлем VR Pico 4", createdAt: new Date("2026-03-01") }]);
    expect(texts("шлем v", vr)).toEqual(["шлем vr"]);
  });

  it("puts words that start a title or are brands first", () => {
    const out = complete("ка");
    expect(out.length).toBeGreaterThan(1);
    const tiers = out.map((c) => c.tier);
    expect(tiers).toEqual([...tiers].sort((a, b) => a - b));
    expect(out[0].tier).toBe(0);
  });

  it("completes a stop word too: it may be the start of a word", () => {
    const rows = fixtureIndex([...ROWS, { ...ROWS[0], id: "X1", title: "Палатка походная трёхместная", createdAt: new Date("2026-03-01") }]);
    expect(texts("палатка по", rows)).toEqual(["палатка походная"]);
    expect(texts("перфоратор для")).toEqual([]);
  });

  it("does not complete after a space — it offers the typed query", () => {
    expect(texts("перфоратор ")).toEqual(["перфоратор"]);
    expect(texts("кувалдометр ")).toEqual([]);
  });

  it("offers nothing when nothing matches", () => {
    expect(texts("кувалдометр")).toEqual([]);
    expect(texts("перфоратор кувалдометр")).toEqual([]);
    expect(texts("п")).toEqual([]);
    expect(texts("прокат")).toEqual([]);
  });

  // Главное правило: подсказка не ведёт в пустую выдачу — и выдача находит её
  // целиком, без отброшенных слов.
  it("every suggested phrase finds something in /search by all its words", () => {
    const inputs = ["перф", "мак", "ка", "ве", "па", "пла", "сап", "бол", "шу", "ин", "перфоратор m", "мойка к", "велосипед с", "ушм"];
    let checked = 0;
    for (const q of inputs) {
      for (const c of complete(q)) {
        const r = rankResults(ix, c.text, 1000);
        expect(r.dropped, c.text).toEqual([]);
        expect(r.hits.length, c.text).toBeGreaterThan(0);
        expect(c.ids).toEqual(r.hits.map((h) => h.row.id));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("evaluates at most MAX_EVALUATED candidates", () => {
    for (const q of ["ка", "по", "ве", "са"]) expect(complete(q).length).toBeLessThanOrEqual(MAX_EVALUATED);
  });

  it("caches per index snapshot", () => {
    const own = fixtureIndex();
    const first = complete("перф", own);
    expect(complete("перф", own)).toBe(first);
    expect(complete("ПЕРФ", own)).toBe(first);
    expect(complete("перф", fixtureIndex())).not.toBe(first);
  });
});

describe("pickCompletions", () => {
  const list = [
    { text: "a", ids: ["1", "2", "3"], tier: 0 },
    { text: "b", ids: ["4"], tier: 0 },
    { text: "c", ids: ["5", "6"], tier: 1 },
  ];

  it("keeps the order and cuts to the limit without dates", () => {
    expect(pickCompletions(list, 2).map((c) => c.text)).toEqual(["a", "b"]);
  });

  it("with dates keeps only phrases with something free and ranks by what is free", () => {
    const out = pickCompletions(list, 6, new Set(["3", "4", "6"]));
    expect(out.map((c) => [c.text, c.ids])).toEqual([["a", ["3"]], ["b", ["4"]], ["c", ["6"]]]);
    expect(pickCompletions(list, 6, new Set(["5"])).map((c) => c.text)).toEqual(["c"]);
    expect(pickCompletions(list, 6, new Set())).toEqual([]);
  });
});
