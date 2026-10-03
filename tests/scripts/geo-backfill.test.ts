// @vitest-environment node
// Backfill адресов сида (scripts/geo-backfill.ts): подпись → адрес с точкой
// своим геокодером, нестрого и от центра города объявления. Чистая часть —
// без БД и файлов: движок из фикстуры (tests/geocoder/fixture.ts).
import { describe, expect, it } from "vitest";
import { FIXTURE } from "../geocoder/fixture";
import { createGeocoder } from "@/lib/geocoder";
import type { GeoIndexData } from "@/lib/geocoder/types";
import { parseCsv, stringifyCsv, type CsvRow } from "@/lib/csv";
import { LISTING_COLUMNS } from "@/lib/seed/rows";
import {
  backfillCsvRows, csvColumns, formatRelabel, formatReport, geocodeListingLabel, relabelCsvRows, type BackfillCity,
} from "../../scripts/geo-backfill";

const data = (): GeoIndexData => ({
  ...FIXTURE,
  places: [
    ...FIXTURE.places,
    { id: "p-zap", name: "Западный", kind: "okrug", aliases: ["Западный округ"], parentId: "p-krd", lat: 45.04, lon: 38.95 },
  ],
  houses: [...FIXTURE.houses],
});
const geocoder = createGeocoder(data());

const CITIES = new Map<string, BackfillCity>([
  ["krasnodar", { id: "krasnodar", name: "Краснодар", region: "krasnodar", centre: { lat: 45.0355, lon: 38.9753 } }],
  ["yablonovskiy", { id: "yablonovskiy", name: "Яблоновский", region: "krasnodar", centre: { lat: 44.988, lon: 38.9475 } }],
  ["kazan", { id: "kazan", name: "Казань", region: null, centre: null }],
]);
const geocoderFor = (region: string) => (region === "krasnodar" ? geocoder : null);

const row = (over: Partial<CsvRow> = {}): CsvRow => ({
  owner: "sergey", city: "krasnodar", category: "Инструменты / Электроинструменты",
  title: "Перфоратор", description: "Бур, зубило, «кейс»", location: "ЮМР",
  price_day: "550", deposit_type: "money", deposit_amount: "3000", quantity: "1",
  handover: "pickup", status: "active", photos: "drill-1.webp", ...over,
});

describe("geocodeListingLabel", () => {
  it("finds a microdistrict by its alias as place precision", () => {
    const line = geocodeListingLabel(geocoder, "ЮМР", CITIES.get("krasnodar")!);
    expect(line.fields).toMatchObject({ address: "Юбилейный, Краснодар", location: "Юбилейный, Краснодар", geoPrecision: "place" });
    expect(line.found).toMatch(/^Юбилейный — микрорайон, Краснодар, \d+\.\d км от центра$/);
  });

  // «улица Садовая» есть и в Яблоновском, и в Новой Адыгее: без пункта решает
  // центр города объявления.
  it("resolves an ambiguous street near the listing's city centre", () => {
    const line = geocodeListingLabel(geocoder, "ул. Садовая", CITIES.get("yablonovskiy")!);
    expect(line.fields).toMatchObject({ address: "улица Садовая, Яблоновский", location: "улица Садовая, Яблоновский", geoPrecision: "street" });
  });

  it("keeps the house number only in the full address", () => {
    const line = geocodeListingLabel(geocoder, "Базовская 21к1", CITIES.get("yablonovskiy")!);
    expect(line.fields).toMatchObject({
      address: "улица Базовская, 21к1, Яблоновский", location: "улица Базовская, Яблоновский", geoPrecision: "house",
    });
  });

  it("counts a whole city or okrug as not found", () => {
    for (const label of ["Краснодар", "Западный округ"]) {
      const line = geocodeListingLabel(geocoder, label, CITIES.get("krasnodar")!);
      expect(line.fields).toBeNull();
      expect(line.reason).toMatch(/город или округ целиком/);
    }
  });

  it("explains a miss", () => {
    expect(geocodeListingLabel(geocoder, "Зузузу", CITIES.get("krasnodar")!).reason).toBeTruthy();
    expect(geocodeListingLabel(geocoder, "", CITIES.get("krasnodar")!).reason).toMatch(/заполните address/);
  });
});

describe("backfillCsvRows", () => {
  it("fills address, location, point and precision where lat is empty", () => {
    const { rows, lines } = backfillCsvRows([row()], CITIES, geocoderFor);
    expect(lines).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      address: "Юбилейный, Краснодар", location: "Юбилейный, Краснодар", precision: "place",
      lat: expect.stringMatching(/^45\.\d+$/), lon: expect.stringMatching(/^38\.\d+$/),
    });
    expect(rows[0].description).toBe("Бур, зубило, «кейс»");
  });

  // Ячейку address человек правит, когда подпись не нашлась: она главнее.
  it("prefers the hand-edited address cell and shows both in the report", () => {
    const { rows, lines } = backfillCsvRows([row({ city: "yablonovskiy", location: "Центр", address: "ул. Садовая" })], CITIES, geocoderFor);
    expect(rows[0]).toMatchObject({ address: "улица Садовая, Яблоновский", precision: "street" });
    expect(lines[0].label).toBe("Центр [ул. Садовая]");
  });

  // Город определяет адрес: строка с адресом в другом городе переезжает туда,
  // а пункт, который не город сервиса, — к ближайшему городу региона.
  it("moves a row to the city of its address and reports it", () => {
    const { rows, lines } = backfillCsvRows([
      row({ city: "yablonovskiy", location: "ЮМР" }),
      row({ title: "Шуруповёрт", city: "yablonovskiy", location: "Садовая, Новая Адыгея" }),
      row({ title: "Лобзик", city: "krasnodar", location: "Базовская 21к1" }),
    ], CITIES, geocoderFor);
    expect(rows.map((r) => r.city)).toEqual(["krasnodar", "krasnodar", "yablonovskiy"]);
    expect(rows[1]).toMatchObject({ address: "улица Садовая, Новая Адыгея", location: "улица Садовая, Новая Адыгея" });
    expect(rows[2]).toMatchObject({ address: "улица Базовская, 21к1, Яблоновский", location: "улица Базовская, Яблоновский" });
    expect(lines.map((l) => l.moveTo?.id)).toEqual(["krasnodar", "krasnodar", "yablonovskiy"]);
    expect(formatReport(lines)).toMatch(/объявление переезжает \(3\)[\s\S]*ЮМР\s+Яблоновский → Краснодар/);
  });

  it("leaves rows with a point, cities without geodata and misses untouched", () => {
    const withPoint = row({ lat: "45.1", lon: "38.9", address: "x", precision: "street" });
    const kazan = row({ city: "kazan", location: "ул. Баумана" });
    const miss = row({ location: "Зузузу" });
    const { rows, lines } = backfillCsvRows([withPoint, kazan, miss], CITIES, geocoderFor);
    expect(rows).toEqual([withPoint, kazan, miss]);
    expect(lines).toHaveLength(1);
    expect(lines[0].fields).toBeNull();
  });

  // Второй прогон по записанной таблице — ничего не ищет и ничего не меняет.
  it("is idempotent through a CSV round trip", () => {
    const first = backfillCsvRows([row(), row({ title: "Шуруповёрт", location: "ул. Садовая", city: "yablonovskiy" })], CITIES, geocoderFor);
    const written = parseCsv(stringifyCsv(first.rows, csvColumns(first.rows)));
    const second = backfillCsvRows(written, CITIES, geocoderFor);
    expect(second.lines).toHaveLength(0);
    expect(second.rows).toEqual(written);
    expect(stringifyCsv(second.rows, csvColumns(written))).toBe(stringifyCsv(first.rows, csvColumns(first.rows)));
  });
});

// Пересчёт подписей у строк с точкой (--relabel): по сохранённой подписи и
// точке находится тот же хит, а подписи — по текущему правилу (свой пункт).
// Точка, точность и город остаются.
describe("relabelCsvRows", () => {
  const relabel = (rows: CsvRow[]) => relabelCsvRows(rows, CITIES, geocoderFor);
  // Подписи по прежнему правилу — без пункта у Краснодара и у «Меги».
  const old = () => {
    const filled = backfillCsvRows([
      row(),
      row({ title: "Лобзик", city: "yablonovskiy", location: "Базовская 21к1" }),
      row({ title: "Шуруповёрт", location: "Садовая, Новая Адыгея", city: "yablonovskiy" }),
    ], CITIES, geocoderFor).rows;
    return [
      { ...filled[0], address: "Юбилейный", location: "Юбилейный" },
      { ...filled[1], address: "улица Базовская, 21к1", location: "улица Базовская" },
      filled[2],
    ];
  };

  it("recomputes labels from the stored point without moving it", () => {
    const before = old();
    const { rows, lines } = relabel(before);
    expect(rows[0]).toMatchObject({ address: "Юбилейный, Краснодар", location: "Юбилейный, Краснодар" });
    expect(rows[1]).toMatchObject({ address: "улица Базовская, 21к1, Яблоновский", location: "улица Базовская, Яблоновский" });
    // Подпись уже по правилу — строка та же и в отчёт не попадает.
    expect(rows[2]).toBe(before[2]);
    expect(lines).toHaveLength(2);
    for (const [i, r] of rows.entries()) {
      expect(r).toMatchObject({ lat: before[i].lat, lon: before[i].lon, precision: before[i].precision, city: before[i].city });
    }
    const text = formatRelabel(lines);
    expect(text).toMatch(/Подписи сменились у 2/);
    expect(text).toMatch(/«улица Базовская» → «улица Базовская, Яблоновский»/);
  });

  it("is idempotent through a CSV round trip", () => {
    const first = relabel(old());
    const written = parseCsv(stringifyCsv(first.rows, csvColumns(first.rows)));
    const second = relabel(written);
    expect(second.lines).toHaveLength(0);
    expect(second.rows).toEqual(written);
  });

  it("leaves rows without a point, cities without geodata and lost hits untouched", () => {
    const noPoint = row();
    const kazan = row({ city: "kazan", location: "ул. Баумана", lat: "55.79", lon: "49.12", precision: "street" });
    // Точка посреди поля: ни подпись, ни обратный геокодер той же точности не находят.
    const lost = row({ address: "Зузузу", location: "Зузузу", lat: "45.3", lon: "39.4", precision: "house" });
    const { rows, lines } = relabel([noPoint, kazan, lost]);
    expect(rows).toEqual([noPoint, kazan, lost]);
    expect(lines).toEqual([{ city: "Краснодар", before: { address: "Зузузу", location: "Зузузу" }, after: null }]);
    expect(formatRelabel(lines)).toMatch(/не нашёлся — подписи не тронуты \(1\)/);
  });
});

describe("csvColumns", () => {
  it("writes the seed's column order and keeps unknown columns at the end", () => {
    expect(csvColumns([{ ...row(), note: "x" }])).toEqual([...LISTING_COLUMNS, "note"]);
  });
});

describe("formatReport", () => {
  it("prints label → found → precision and lists the misses", () => {
    const { lines } = backfillCsvRows([row(), row({ location: "Зузузу" })], CITIES, geocoderFor);
    const text = formatReport(lines);
    expect(text).toMatch(/Найдено 1 из 2/);
    expect(text).toMatch(/ЮМР\s+→ Юбилейный — микрорайон, Краснодар, .* → place/);
    expect(text).toMatch(/Не найдено 1:[\s\S]*Зузузу/);
  });
});
