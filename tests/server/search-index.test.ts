import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Кэш индекса поиска: когда он собирается заново, а когда отвечает из памяти.
// БД мокается построителем, который запоминает каждый запрос (таблицу, поля,
// join'ы и where) и отвечает данными теста по таблице.
const db = vi.hoisted(() => {
  interface Call {
    fields: Record<string, unknown>;
    from: unknown;
    joins: unknown[];
    where: unknown;
  }
  const calls: Call[] = [];
  const state = { answer: (_call: Call): unknown[] => [] };
  return { calls, state };
});

vi.mock("@/lib/db", () => {
  const select = (fields: Record<string, unknown>) => {
    const call = { fields, from: null as unknown, joins: [] as unknown[], where: null as unknown };
    db.calls.push(call);
    const chain: unknown = new Proxy({}, {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (rows: unknown[]) => void, reject: (e: unknown) => void) => {
            try { resolve(db.state.answer(call)); } catch (e) { reject(e); }
          };
        }
        return (...args: unknown[]) => {
          if (prop === "from") call.from = args[0];
          if (prop === "innerJoin") call.joins.push(args[1]);
          if (prop === "where") call.where = args[0];
          return chain;
        };
      },
    });
    return chain;
  };
  return { getDb: () => ({ select }), getPool: () => ({}) };
});

import { categories, cities, listings } from "@db/schema";
import { getSearchIndex, invalidateSearchIndex, VERSION_TTL_MS } from "@/server/search-index";
import { rankListings } from "@/lib/search/listing-index";
import { rankListingIds } from "@/server/search";
import { renderSql } from "../fixtures/render-sql";

const CITY = "city-1";

const CATS = [
  { id: "tools", parentId: null, name: "Инструменты", slug: "instrumenty" },
  { id: "power", parentId: "tools", name: "Электроинструменты", slug: "elektroinstrumenty" },
];

function row(id: string, title: string) {
  return {
    id, slug: `l-${id}`, title, description: "Кейс и запасные щётки", categoryId: "power",
    cityId: CITY, createdAt: new Date("2026-09-01T00:00:00Z"), priceDay: 500, photoUrl: null,
  };
}

let data: {
  version: { n: number; last: string };
  rows: ReturnType<typeof row>[];
  cities: { id: string; slug: string; name: string; nameLocative: string | null }[];
};

const isVersion = (c: (typeof db.calls)[number]) => c.from === listings && "n" in c.fields;
const isRows = (c: (typeof db.calls)[number]) => c.from === listings && "title" in c.fields;
const versionReads = () => db.calls.filter(isVersion).length;
const builds = () => db.calls.filter(isRows).length;

beforeEach(() => {
  db.calls.length = 0;
  data = {
    version: { n: 1, last: "2026-09-01 00:00:00.000001" },
    rows: [row("A", "Перфоратор Bosch")],
    cities: [{ id: CITY, slug: "kazan", name: "Казань", nameLocative: "Казани" }],
  };
  db.state.answer = (call) => {
    if (isVersion(call)) return [data.version];
    // Свежие объекты на каждую сборку: сборка отпускает описания у своих строк.
    if (isRows(call)) return data.rows.map((r) => ({ ...r }));
    if (call.from === categories) return CATS;
    if (call.from === cities) return data.cities;
    return [];
  };
  invalidateSearchIndex();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

const later = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms));
const titles = async (q: string) =>
  rankListings((await getSearchIndex([CITY])).ix, q, { mode: "results", limit: 10 }).map((h) => h.row.title);

describe("getSearchIndex", () => {
  it("builds once and answers from memory while the version is fresh", async () => {
    await getSearchIndex([CITY]);
    later(VERSION_TTL_MS - 1);
    await getSearchIndex([CITY]);

    expect(builds()).toBe(1);
    expect(versionReads()).toBe(1); // только при сборке
  });

  it("shares one build between concurrent requests", async () => {
    const [a, b] = await Promise.all([getSearchIndex([CITY]), getSearchIndex([CITY])]);
    expect(a).toBe(b);
    expect(builds()).toBe(1);
  });

  it("checks the version after the TTL and keeps the index when nothing changed", async () => {
    const first = await getSearchIndex([CITY]);
    later(VERSION_TTL_MS + 1);
    const second = await getSearchIndex([CITY]);

    expect(second).toBe(first);
    expect(versionReads()).toBe(2);
    expect(builds()).toBe(1);

    // Сверка продлевает свежесть: следующий запрос снова из памяти.
    await getSearchIndex([CITY]);
    expect(versionReads()).toBe(2);
  });

  // Сиды и правки из других процессов инвалидацию не зовут — их ловит версия.
  it("rebuilds after the TTL when the version moved", async () => {
    expect(await titles("перфоратор")).toEqual(["Перфоратор Bosch"]);

    data.rows = [row("A", "Перфоратор Bosch"), row("B", "Перфоратор Makita")];
    data.version = { n: 2, last: "2026-10-03 12:00:10.000000" };
    later(VERSION_TTL_MS + 1);

    expect(await titles("перфоратор")).toHaveLength(2);
    expect(builds()).toBe(2);
  });

  it("rebuilds right after invalidateSearchIndex, without waiting for the TTL", async () => {
    await getSearchIndex([CITY]);
    data.rows = [];
    invalidateSearchIndex();

    expect(await titles("перфоратор")).toEqual([]);
    expect(builds()).toBe(2);
  });

  // Сборка, начатая до инвалидации, могла прочитать строки до правки: ответить
  // ей тем, кто её уже ждёт, можно, а оставить в кэше — нет.
  it("does not cache a build that an invalidation overtook", async () => {
    const pending = getSearchIndex([CITY]);
    invalidateSearchIndex();
    await pending;

    await getSearchIndex([CITY]);
    expect(builds()).toBe(2);
  });

  it("keeps hidden, archived, banned and disabled-city listings out", async () => {
    await getSearchIndex([CITY]);
    const call = db.calls.find(isRows)!;
    const sql = [call.where, ...call.joins].map(renderSql).join(" and ");

    expect(sql).toContain(`"listings"."status" = 'active'`);
    expect(sql).toContain(`"users"."banned_at" is null`);
    expect(sql).toMatch(/"cities"\."is_active" = (true|\$\d+)/);
    expect(sql).toContain(`"listings"."city_id" in ('${CITY}')`);
  });

  it("drops descriptions from the rows once their words are indexed", async () => {
    const { ix } = await getSearchIndex([CITY]);
    expect(ix.listings[0].description).toBeNull();
    // Слова описания при этом ищутся: они уже в словаре индекса.
    expect(rankListings(ix, "щётки", { mode: "results", limit: 5 })).toHaveLength(1);
  });

  // Названия городов — стоп-слова, и берутся они в момент сборки. Переименованный
  // город становится стоп-словом после инвалидации (её зовёт adminUpdateCity).
  it("treats a renamed city as a stop word after invalidation", async () => {
    expect(await titles("перфоратор энск")).toEqual([]);

    data.cities = [{ id: CITY, slug: "kazan", name: "Энск", nameLocative: "Энске" }];
    invalidateSearchIndex();

    expect(await titles("перфоратор энск")).toEqual(["Перфоратор Bosch"]);
    expect(await titles("перфоратор в энске")).toEqual(["Перфоратор Bosch"]);
  });

  it("maps categories and city slugs for building links", async () => {
    const index = await getSearchIndex([CITY]);
    expect(index.categories.get("power")?.slug).toBe("elektroinstrumenty");
    expect(index.citySlugs.get(CITY)).toBe("kazan");
  });
});

// Без моков ранжирования: запрос из одних стоп-слов (и названия города) — не
// запрос, выдача показывает весь город, а не ищет «прокат» буквально.
describe("rankListingIds", () => {
  it("treats service words and the city name as no query", async () => {
    expect(await rankListingIds([CITY], "прокат")).toEqual({ ids: null, usedQuery: "прокат", dropped: [] });
    expect((await rankListingIds([CITY], "прокат в Казани")).ids).toBeNull();
    expect((await rankListingIds([CITY], "прокат перфоратора в Казани")).ids).toEqual(["A"]);
  });

  it("cuts an oversized query to the suggest route's length", async () => {
    const r = await rankListingIds([CITY], `перфоратор ${"x".repeat(5000)}`);
    expect(r.ids).toEqual(["A"]);
    expect(r.dropped).toEqual(["x".repeat(200 - "перфоратор ".length)]);
  });
});
