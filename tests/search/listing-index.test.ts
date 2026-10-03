import { describe, expect, it } from "vitest";
import {
  listingFields, popularCategories, rankListings, rankResults, suggestCategories,
  type IndexCategory, type ListingIndex,
} from "@/lib/search/listing-index";
import { matchToken, queryTokens, tokenForms, withoutTypoNoise } from "@/lib/search/match";
import { compact } from "@/lib/search/text";
import { CATEGORIES, ROWS, fixtureIndex, type FixtureListing } from "./fixture";

const ix = fixtureIndex();
const titles = (q: string, mode: "suggest" | "results" = "suggest", limit = 50) =>
  rankListings(ix, q, { mode, limit }).map((h) => h.row.title);

describe("listings", () => {
  it("finds through typos, word forms and the wrong layout", () => {
    expect(titles("перфаратор").slice(0, 2).sort()).toEqual(["Перфоратор Bosch GBH 2-26 DFR", "Перфоратор Makita HR2470"]);
    expect(titles("gthajhfnjh")).toContain("Перфоратор Makita HR2470");
    expect(titles("дрели")[0]).toBe("Дрель ударная Интерскол ДУ-13/780ЭР");
    expect(titles("ьфлшеф")).toContain("УШМ Makita 9558HN");
  });

  it("every word must match", () => {
    expect(titles("makita шуруповерт")).toEqual(["Шуруповёрт Makita DF333D с двумя АКБ"]);
    expect(titles("перфоратор makita")).toEqual(["Перфоратор Makita HR2470"]);
  });

  it("synonyms find the other name of the thing", () => {
    expect(titles("болгарка").slice(0, 2).sort()).toEqual(["Болгарка DeWalt 125 мм", "УШМ Makita 9558HN"]);
    expect(titles("велик")).toEqual(expect.arrayContaining(["Горный велосипед Trek Marlin 5, рама M", "Городской велосипед с корзиной"]));
    expect(titles("sup")).toEqual(["Сапборд надувной 10'8″ с веслом"]);
    expect(titles("керхер")).toEqual(expect.arrayContaining(["Моющий пылесос Karcher SE 4001", "Пароочиститель Karcher SC 3"]));
  });

  it("category keywords match every listing of the category, below the title", () => {
    expect(titles("химчистка")).toEqual(expect.arrayContaining(["Моющий пылесос Karcher SE 4001"]));
    expect(titles("дача")).toEqual(expect.arrayContaining(["Бензопила Stihl MS 180", "Триммер электрический 1200 Вт"]));
    // «пылесос» в заголовке сильнее раздела «Уборочная техника».
    expect(titles("моющий")[0]).toBe("Моющий пылесос Karcher SE 4001");
  });

  it("a match only in the description is not a suggestion but is a result, in the tail", () => {
    expect(titles("зубило")).toEqual([]);
    const results = rankListings(ix, "зубило", { mode: "results", limit: 10 });
    expect(results.map((h) => [h.row.title, h.byDescription])).toEqual([["Перфоратор Bosch GBH 2-26 DFR", true]]);

    // «бур» есть только в описаниях: оба перфоратора — в выдаче, но не в подсказках.
    const bur = rankListings(ix, "перфоратор бур", { mode: "results", limit: 10 });
    expect(bur.map((h) => h.byDescription)).toEqual([true, true]);
    expect(titles("перфоратор бур")).toEqual([]);
  });

  it("service words and city names are dropped", () => {
    expect(titles("прокат перфоратора в краснодаре")).toEqual(titles("перфоратор"));
    expect(titles("каяк яблоновский")).toEqual(["Каяк надувной двухместный"]);
  });

  it("a single letter is not a query", () => {
    expect(titles("с")).toEqual([]);
    expect(titles("d", "results")).toEqual([]);
  });

  it("equal score — newer first", () => {
    const twin: FixtureListing = { ...ROWS[0], id: "L99", createdAt: new Date(Date.UTC(2027, 0, 1)) };
    const withTwin = fixtureIndex([...ROWS, twin]);
    const ids = rankListings(withTwin, "перфоратор bosch", { mode: "suggest", limit: 5 }).map((h) => h.row.id);
    expect(ids.slice(0, 2)).toEqual(["L99", ROWS[0].id]);
  });

  it("respects the limit", () => {
    expect(titles("велосипед", "suggest", 2)).toHaveLength(2);
  });
});

// R8: без фасетов верх выдачи — ровно подсказки, в том же порядке.
describe("results start with the suggestions", () => {
  for (const q of ["перфоратор", "makita", "болгарка", "велик", "karcher", "платье", "дача", "перфоратор бур", "зубило", "бетон"]) {
    it(q, () => {
      const suggest = rankListings(ix, q, { mode: "suggest", limit: 100 });
      const results = rankListings(ix, q, { mode: "results", limit: 100 });
      expect(results.slice(0, suggest.length)).toEqual(suggest);
      expect(results.slice(suggest.length).every((h) => h.byDescription)).toBe(true);
    });
  }
});

// R8 с датами. Подсказки берут верх ранжирования подсказок и отсеивают занятые
// (getFreeListingIds), выдача — свой список и то же условие в SQL с порядком по
// позиции id. Отсев порядок не меняет, поэтому подсказки остаются началом
// выдачи; что условие одно и то же — tests/server/catalog-search.test.ts.
describe("results start with the suggestions when dates are set", () => {
  const busy = new Set(ROWS.filter((_, i) => i % 3 === 0).map((r) => r.id));
  const free = (h: { row: FixtureListing }) => !busy.has(h.row.id);
  for (const q of ["перфоратор", "makita", "болгарка", "велик", "дача", "бетон"]) {
    it(q, () => {
      const suggest = rankListings(ix, q, { mode: "suggest", limit: 50 }).filter(free).slice(0, 6);
      const results = rankListings(ix, q, { mode: "results", limit: 100 }).filter(free);
      expect(results.slice(0, suggest.length)).toEqual(suggest);
    });
  }
});

// Наивный перебор — matchToken по каждой записи, как в sravniprokat.
function naive(index: ListingIndex<FixtureListing>, rows: FixtureListing[], q: string, withExtra: boolean) {
  if (compact(q).length < 2) return [];
  const byId = new Map<string, IndexCategory>(CATEGORIES.map((c) => [c.id, c]));
  const tokens = queryTokens(q, index.stopWords);
  const forms = tokens.map(tokenForms);
  const out: { id: string; score: number; created: number; i: number }[] = [];
  rows.forEach((row, i) => {
    const cat = byId.get(row.categoryId);
    const fields = listingFields(row, cat, cat?.parentId ? byId.get(cat.parentId) : undefined);
    let sum = 0;
    for (const f of forms) {
      const m = matchToken(f, fields, withExtra);
      if (!m) return;
      sum += m.score;
    }
    out.push({ id: row.id, score: sum / forms.length, created: row.createdAt.getTime(), i });
  });
  return out.sort((a, b) => b.score - a.score || b.created - a.created || a.i - b.i);
}

describe("dictionary and postings equal the naive scan", () => {
  // Описания подлиннее, чтобы поле extra не было пустым почти у всех.
  const rows: FixtureListing[] = ROWS.map((r, i) => ({
    ...r,
    description: `${r.description ?? ""} ${ROWS[(i * 7) % ROWS.length].title} бетон дерево металл ковры`.trim(),
  }));
  const index = fixtureIndex(rows);
  const queries = [
    "перфоратор", "перфо", "перфаратор", "gthajhfnjh", "makita", "ьфлшеф", "НR2470", "gbh 2-26", "болгарку",
    "велики", "сап", "керхер", "химчистка", "дача", "инструмент", "платье 44", "бетон", "металла", "ковер",
    "дерев", "makita шуруповерт", "электро самокат", "прокат каяка", "бур", "зубило", "ш", "мм", "2",
    "lfxf", "палатка поход", "стабилизатор dji", "игровая приставка", "ps5", "свадебное", "косилка",
  ];

  for (const q of queries) {
    it(q, () => {
      const suggest = rankListings(index, q, { mode: "suggest", limit: 1000 });
      const matched = naive(index, rows, q, false);
      const expectSuggest = withoutTypoNoise(matched);
      expect(suggest.map((h) => [h.row.id, h.score])).toEqual(expectSuggest.map((h) => [h.id, h.score]));

      const results = rankListings(index, q, { mode: "results", limit: 1000 });
      // Отброшенные как шум опечаток в хвост не возвращаются.
      const inSuggest = new Set(matched.map((h) => h.id));
      const tail = naive(index, rows, q, true).filter((h) => !inSuggest.has(h.id));
      expect(results.map((h) => [h.row.id, h.score])).toEqual(
        [...expectSuggest, ...tail].map((h) => [h.id, h.score]),
      );
    });
  }
});

describe("subsets when the whole query finds nothing", () => {
  it("drops the word that found nothing", () => {
    const r = rankResults(ix, "перфоратор кувалдометр", 100);
    expect(r.usedQuery).toBe("перфоратор");
    expect(r.dropped).toEqual(["кувалдометр"]);
    expect(r.hits.map((h) => h.row.title)).toEqual(titles("перфоратор", "results"));
  });

  it("keeps the strongest part", () => {
    const r = rankResults(ix, "дрель ударная кувалдометр", 100);
    expect(r.usedQuery).toBe("дрель ударная");
    expect(r.dropped).toEqual(["кувалдометр"]);
  });

  it("the whole query found something — nothing is dropped", () => {
    expect(rankResults(ix, " перфоратор makita ", 100)).toMatchObject({ usedQuery: "перфоратор makita", dropped: [] });
  });

  // Слов больше потолка: ищутся первые MAX_QUERY_WORDS, и отброшенное слово
  // из них сообщается, а не теряется молча.
  it("caps the words and still drops only the one that found nothing", () => {
    const r = rankResults(ix, "перфоратор makita кувалдометр hr2470 перфоратор makita дрель", 100);
    expect(r.dropped).toEqual(["кувалдометр"]);
    expect(r.hits[0].row.title).toBe("Перфоратор Makita HR2470");
  });

  it("one word has no parts to try", () => {
    expect(rankResults(ix, "кувалдометр", 100)).toEqual({ hits: [], usedQuery: "кувалдометр", dropped: [] });
  });
});

describe("categories", () => {
  const names = (q: string) => suggestCategories(ix, q).map((c) => c.category.name);

  it("suggests subcategories and roots that have listings", () => {
    expect(names("электро")[0]).toBe("Электроинструменты");
    expect(names("инструмент")).toEqual(expect.arrayContaining(["Инструменты", "Ручной инструмент"]));
    // «Садовая техника» — только по корню «Инструменты»: не подсказка.
    expect(names("инструмент")).not.toContain("Садовая техника");
    // Раздел без объявлений в городе не подсказывается.
    expect(names("дроны")).toEqual([]);
  });

  it("matches keywords", () => {
    expect(names("химчистка")).toEqual(["Уборочная техника"]);
  });

  it("gives the path and the count, roots counting subcategories", () => {
    const [tools] = suggestCategories(ix, "инструменты");
    expect(tools).toMatchObject({ slugs: ["instrumenty"], root: null });
    expect(tools.count).toBe(ROWS.filter((r) => CATEGORIES.find((c) => c.id === r.categoryId)?.parentId === "instrumenty").length);
    expect(suggestCategories(ix, "уборочная")[0]).toMatchObject({ slugs: ["dom-i-meropriyatiya", "uborochnaya-tekhnika"], count: 3 });
  });

  it("blank query — popular subcategories", () => {
    const popular = suggestCategories(ix, "с");
    expect(popular).toEqual(popularCategories(ix, 4));
    expect(popular[0].category.name).toBe("Электроинструменты");
    expect(popular.every((c) => c.root)).toBe(true);
    expect(popular.map((c) => c.count)).toEqual([...popular.map((c) => c.count)].sort((a, b) => b - a));
  });
});

describe("typos only when nothing matches clearly", () => {
  it("does not offer a dress next to the tent a prefix already found", () => {
    expect(titles("палатк")).toEqual(["Палатка четырёхместная Naturehike с тамбуром"]);
    expect(suggestCategories(ix, "палатк").map((c) => c.category.name)).not.toContain("Вечерняя одежда");
  });

  it("still finds by a typo when that is all there is", () => {
    expect(titles("перфаратор").length).toBeGreaterThan(0);
    expect(titles("перфаратор").every((t) => t.startsWith("Перфоратор"))).toBe(true);
  });

  it("keeps a two-word query where only one word has a typo", () => {
    expect(titles("палатка тамбуор")).toEqual(["Палатка четырёхместная Naturehike с тамбуром"]);
  });

  it("keeps the noise out of the results tail too", () => {
    const results = rankListings(ix, "палатк", { mode: "results", limit: 100 }).map((h) => h.row.title);
    expect(results.some((t) => /платье/i.test(t))).toBe(false);
  });
});
