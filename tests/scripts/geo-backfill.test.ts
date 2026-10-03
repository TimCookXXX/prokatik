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
  backfillCsvRows, csvColumns, formatReport, geocodeListingLabel, type BackfillCity,
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
  ["krasnodar", { name: "Краснодар", region: "krasnodar", centre: { lat: 45.0355, lon: 38.9753 } }],
  ["yablonovskiy", { name: "Яблоновский", region: "krasnodar", centre: { lat: 44.988, lon: 38.9475 } }],
  ["kazan", { name: "Казань", region: null, centre: null }],
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
    expect(line.fields).toMatchObject({ address: "Юбилейный", location: "Юбилейный", geoPrecision: "place" });
    expect(line.found).toMatch(/^Юбилейный — микрорайон, Краснодар, \d+\.\d км от центра$/);
  });

  // «улица Садовая» есть и в Яблоновском, и в Новой Адыгее: без пункта решает
  // центр города объявления.
  it("resolves an ambiguous street near the listing's city centre", () => {
    const line = geocodeListingLabel(geocoder, "ул. Садовая", CITIES.get("yablonovskiy")!);
    expect(line.fields).toMatchObject({ address: "улица Садовая", location: "улица Садовая", geoPrecision: "street" });
  });

  it("keeps the house number only in the full address", () => {
    const line = geocodeListingLabel(geocoder, "Базовская 21к1", CITIES.get("yablonovskiy")!);
    expect(line.fields).toMatchObject({
      address: "улица Базовская, 21к1", location: "улица Базовская", geoPrecision: "house",
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
      address: "Юбилейный", location: "Юбилейный", precision: "place",
      lat: expect.stringMatching(/^45\.\d+$/), lon: expect.stringMatching(/^38\.\d+$/),
    });
    expect(rows[0].description).toBe("Бур, зубило, «кейс»");
  });

  // Ячейку address человек правит, когда подпись не нашлась: она главнее.
  it("prefers the hand-edited address cell and shows both in the report", () => {
    const { rows, lines } = backfillCsvRows([row({ city: "yablonovskiy", location: "Центр", address: "ул. Садовая" })], CITIES, geocoderFor);
    expect(rows[0]).toMatchObject({ address: "улица Садовая", precision: "street" });
    expect(lines[0].label).toBe("Центр [ул. Садовая]");
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
