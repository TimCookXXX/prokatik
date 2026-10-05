// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// Геоданные города в админке: центр и регион из загруженных. Action доступен по
// сети напрямую, поэтому диапазоны и существование региона проверяет он, а не
// форма. БД мокается построителем: select по geo_imports отвечает загруженными
// регионами, остальные select — пусто (дублей нет), returning — одной строкой.
const { authMock, invalidateGeo, db } = vi.hoisted(() => {
  const db = {
    regions: [] as string[],
    writes: [] as { op: string; values: Record<string, unknown> }[],
    selects: 0,
  };
  return { authMock: vi.fn(), invalidateGeo: vi.fn(), db };
});

vi.mock("@/lib/db", async () => {
  const schema = await import("@db/schema");
  const { renderSql } = await import("../fixtures/render-sql");
  const chain = (kind: "select" | "insert" | "update") => {
    let table: unknown = null;
    let where = "";
    let returning = false;
    const self: unknown = new Proxy({}, {
      get(_t, prop) {
        if (prop === "then") {
          return (resolve: (rows: unknown[]) => void) => {
            if (kind === "select") {
              db.selects++;
              if (table !== schema.geoImports) return resolve([]);
              return resolve(db.regions.filter((r) => where.includes(`'${r}'`)).map((r) => ({ id: r })));
            }
            resolve(returning ? [{ id: "city" }] : []);
          };
        }
        return (...args: unknown[]) => {
          if (prop === "from") table = args[0];
          if (prop === "where") where = renderSql(args[0]);
          if (prop === "returning") returning = true;
          if (prop === "values" || prop === "set") db.writes.push({ op: kind, values: args[0] as Record<string, unknown> });
          return self;
        };
      },
    });
    return self;
  };
  return {
    getDb: () => ({ select: () => chain("select"), insert: () => chain("insert"), update: () => chain("update") }),
  };
});
vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/search-index", () => ({ invalidateSearchIndex: vi.fn() }));
vi.mock("@/server/city", () => ({ invalidateCitiesGeo: invalidateGeo }));
vi.mock("@/server/realtime", () => ({ publish: vi.fn() }));
vi.mock("@/server/notifications", () => ({ notify: vi.fn() }));
vi.mock("@/server/deal-note", () => ({ writeDealNote: vi.fn() }));

import { adminCreateCity, adminSetCityActive, adminUpdateCity } from "@/server/actions/admin";

const admin = { user: { id: "admin", role: "admin", bannedAt: null } };
const base = { name: "Яблоновский", region: "Республика Адыгея", nameLocative: "Яблоновском" };

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue(admin);
  db.regions = ["krasnodar"];
  db.writes = [];
  db.selects = 0;
});

describe("геоданные города в админке", () => {
  it("пишет центр и регион из загруженных и сбрасывает гео-контекст", async () => {
    const res = await adminUpdateCity("city", { ...base, lat: "44.9864341", lon: "38.9382841", geoRegion: "krasnodar" });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(db.writes.at(-1)?.values).toMatchObject({ lat: 44.9864341, lon: 38.9382841, geoRegion: "krasnodar" });
    expect(invalidateGeo).toHaveBeenCalledTimes(1);
  });

  it("принимает десятичную запятую и числа", async () => {
    expect(await adminCreateCity({ ...base, lat: "44,98", lon: 38.93, geoRegion: "krasnodar" })).toMatchObject({ ok: true });
    expect(db.writes.at(-1)?.values).toMatchObject({ lat: 44.98, lon: 38.93, geoRegion: "krasnodar" });
  });

  it("пустые поля — без геоданных: NULL, а не точка (0, 0)", async () => {
    expect(await adminUpdateCity("city", { ...base, lat: "", lon: " ", geoRegion: "" })).toMatchObject({ ok: true });
    expect(db.writes.at(-1)?.values).toMatchObject({ lat: null, lon: null, geoRegion: null });
  });

  it("старый клиент без новых полей сохраняет город без геоданных", async () => {
    expect(await adminCreateCity({ name: "Энск" })).toMatchObject({ ok: true });
    expect(db.writes.at(-1)?.values).toMatchObject({ lat: null, lon: null, geoRegion: null });
  });

  it.each([
    [{ lat: "95", lon: "38" }, /Широта/],
    [{ lat: "45", lon: "-181" }, /Долгота/],
    [{ lat: "abc", lon: "38" }, /Широта/],
    [{ lat: "45", lon: "" }, /вместе/],
    [{ lat: "", lon: "", geoRegion: "krasnodar" }, /центр города/],
  ])("отвергает %j", async (geo, message) => {
    const res = await adminUpdateCity("city", { ...base, geoRegion: "", ...geo });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(message);
    expect(db.writes).toEqual([]);
    expect(invalidateGeo).not.toHaveBeenCalled();
  });

  it("регион не из geo_imports — ошибка, город не пишется", async () => {
    const res = await adminCreateCity({ ...base, lat: "43.58", lon: "39.72", geoRegion: "sochi" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/sochi.*geo:import/);
    expect(db.writes).toEqual([]);
  });

  it("без прав админа ничего не проверяет и не пишет", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", role: "user" } });
    expect(await adminUpdateCity("city", { ...base, lat: "45", lon: "39", geoRegion: "krasnodar" }))
      .toEqual({ ok: false, error: "forbidden" });
    expect(db.selects).toBe(0);
    expect(db.writes).toEqual([]);
  });

  it("включение и выключение города сбрасывает гео-контекст", async () => {
    expect(await adminSetCityActive("city", false)).toMatchObject({ ok: true });
    expect(invalidateGeo).toHaveBeenCalledTimes(1);
  });
});
