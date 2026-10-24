import { describe, it, expect } from "vitest";
import type { SeedData, SeedListingRow, SeedUserRow } from "@/lib/seed/rows";
import {
  changedFields, emptyEntityReport, formatSeedReport, parseSeedArgs, scopeSeedData,
} from "@/lib/seed/scope";

describe("parseSeedArgs", () => {
  it("без флагов — всё, без отката", () => {
    expect(parseSeedArgs([])).toEqual({ ok: true, args: { dryRun: false, owners: null } });
  });

  it("--dry-run и --owners в обеих записях, ключи без дублей", () => {
    expect(parseSeedArgs(["--owners", "a,b", "--dry-run", "--owners=b,c"]))
      .toEqual({ ok: true, args: { dryRun: true, owners: ["a", "b", "c"] } });
  });

  it("--owners без ключей и неизвестный флаг — ошибка, а не молчаливый полный прогон", () => {
    expect(parseSeedArgs(["--owners"]).ok).toBe(false);
    expect(parseSeedArgs(["--owners="]).ok).toBe(false);
    expect(parseSeedArgs(["--dryrun"])).toMatchObject({ ok: false, error: expect.stringContaining("--dryrun") });
  });
});

describe("scopeSeedData", () => {
  const u = (key: string) => ({ key, email: `${key}@x.ru` }) as SeedUserRow;
  const l = (owner: string, title: string) => ({ owner, title }) as SeedListingRow;
  const data: SeedData = {
    cities: [{ slug: "krasnodar" } as SeedData["cities"][number]],
    users: [u("a"), u("b"), u("c")],
    listings: [l("a", "1"), l("b", "2"), l("a", "3"), l("c", "4")],
  };

  it("null — таблицы как есть", () => {
    expect(scopeSeedData(data, null)).toEqual({ ok: true, data });
  });

  it("только названные владельцы и их объявления; города целиком — для поиска id", () => {
    const r = scopeSeedData(data, ["a", "c"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.users.map((x) => x.key)).toEqual(["a", "c"]);
    expect(r.data.listings.map((x) => x.title)).toEqual(["1", "3", "4"]);
    expect(r.data.cities).toBe(data.cities);
  });

  it("опечатка в ключе — ошибка, а не «записано ноль строк»", () => {
    expect(scopeSeedData(data, ["a", "zz"])).toEqual({ ok: false, error: "в users.csv нет владельцев: zz" });
  });
});

describe("changedFields", () => {
  it("называет поля, которые запишутся иначе; NULL и отсутствие — одно", () => {
    expect(changedFields(
      { name: "A", phone: null, minDays: 1, photos: [{ url: "x" }] },
      { name: "B", phone: undefined, minDays: 1, photos: [{ url: "x" }], priceWeek: null },
    )).toEqual(["name"]);
  });
});

describe("formatSeedReport", () => {
  it("dry-run помечен, «+» — создано, «~» — обновлено с полями; с --owners городов нет", () => {
    const lines = formatSeedReport({
      dryRun: true, ownersOnly: true, categories: ["Транспорт / Электровелосипеды"],
      cities: emptyEntityReport(),
      users: { created: ["pikavel <p@x.ru>"], updated: [], unchanged: 0 },
      listings: { created: [], updated: [{ key: "vitaliy «Е»", fields: ["categoryId"] }], unchanged: 6 },
      photos: 13, devPasswords: 0,
    });
    expect(lines).toEqual([
      "DRY RUN — транзакция откатана, в базе ничего не изменилось.",
      "Категории: создано 1 — Транспорт / Электровелосипеды",
      "Города: не трогаются (--owners)",
      "Владельцы: создано 1, обновлено 0, без изменений 0",
      "  + pikavel <p@x.ru>",
      "Объявления: создано 0, обновлено 1, без изменений 6",
      "  ~ vitaliy «Е»: categoryId",
      "Фотографий в объявлениях: 13",
    ]);
  });
});
