import { describe, expect, it } from "vitest";
import { haversineKm } from "@/lib/geo/point";
import {
  GEOLOCATION_EXACT_M, geolocationPoint, locationQuery, parseLocation, type UserPoint,
} from "@/lib/geo/location";

// Генеричная часть sravniprokat tests/compare/geo.test.ts: гаверсинус и кодек
// «Где» в адресе. Районов и округов здесь нет — `d:`/`o:` означают «без точки».

describe("haversineKm", () => {
  it("a tenth of a degree of latitude is about 11 km", () => {
    expect(haversineKm({ lat: 45, lon: 39 }, { lat: 45.1, lon: 39 })).toBeCloseTo(11.12, 1);
  });

  it("is symmetric and zero for the same point", () => {
    const a = { lat: 45.035, lon: 38.975 };
    const b = { lat: 44.995, lon: 38.94 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 10);
    expect(haversineKm(a, a)).toBe(0);
  });

  it("Krasnodar centre → Yablonovsky is a few km in a straight line", () => {
    const km = haversineKm({ lat: 45.0355, lon: 38.9753 }, { lat: 44.9913, lon: 38.9412 });
    expect(km).toBeGreaterThan(4);
    expect(km).toBeLessThan(7);
  });
});

describe("location in the URL", () => {
  const point = (over: Partial<UserPoint> = {}): UserPoint => ({
    point: { lat: 45.035, lon: 38.975 }, label: "ул. Красная", source: "address", precision: "house", ...over,
  });

  it("round-trips a point with every source and precision", () => {
    for (const p of [
      point(),
      point({ label: null }),
      point({ source: "geo", label: "рядом: улица Красная" }),
      point({ precision: "street" }),
      point({ precision: "place", label: "ЖК Солнечный" }),
    ]) {
      expect(parseLocation(locationQuery(p))).toEqual(p);
    }
  });

  // Адрес страницы уезжает в «поделиться», историю и Метрику: 3 знака — около
  // 100 м, дом по ним не найти.
  it("writes the point with three decimals", () => {
    const q = locationQuery(point({ point: { lat: 45.0621149, lon: 38.9520081 } }));
    expect(q.loc).toBe("p:45.062,38.952");
    expect(parseLocation(q)?.point).toEqual({ lat: 45.062, lon: 38.952 });
    expect(locationQuery(point({ point: { lat: 45, lon: 39 } })).loc).toBe("p:45.000,39.000");
  });

  it("writes only what is known: no la without a label, src only for geolocation, lp only when approximate", () => {
    expect(locationQuery(point({ label: null }))).toEqual({ loc: "p:45.035,38.975" });
    expect(locationQuery(point({ source: "geo", precision: "street", label: "  " })))
      .toEqual({ loc: "p:45.035,38.975", src: "geo", lp: "s" });
    expect(locationQuery(point({ precision: "place" })).lp).toBe("t");
  });

  // Старые ссылки sravniprokat несли 5 знаков и не знали lp — это дом.
  it("reads older links with more decimals and without lp", () => {
    expect(parseLocation({ loc: "p:45.06211,38.95201", la: "ул. Северная, 15" })).toEqual({
      point: { lat: 45.06211, lon: 38.95201 }, label: "ул. Северная, 15", source: "address", precision: "house",
    });
  });

  it("trims and caps the label, ignores unknown src and lp", () => {
    const p = parseLocation({ loc: " p:45.035,38.975 ", la: `  ${"а".repeat(200)}  `, src: "gps", lp: "x" });
    expect(p?.label).toHaveLength(120);
    expect(p?.source).toBe("address");
    expect(p?.precision).toBe("house");
  });

  it("has no point on garbage, districts and okrugs", () => {
    for (const loc of [
      undefined, null, "", "p:", "p:999.1,1.1", "p:45.1,181.5", "p:abc", "p:45,39", "p:45.1;39.1",
      "p:45.1,39.1,1.1", "d:yubileynyy", "o:prikubanskiy", "x:45.1,39.1", "45.1,39.1",
    ]) {
      expect(parseLocation({ loc }), String(loc)).toBeNull();
    }
  });

  // Повторённый ключ Next отдаёт массивом: берётся первое значение, а не 500.
  it("takes the first value of a repeated key and ignores non-strings", () => {
    expect(parseLocation({ loc: ["p:45.035,38.975", "x"], la: ["ул. Красная", "y"], src: ["geo"], lp: ["t", "s"] }))
      .toEqual({ point: { lat: 45.035, lon: 38.975 }, label: "ул. Красная", source: "geo", precision: "place" });
    expect(parseLocation({ loc: ["x", "p:45.035,38.975"] })).toBeNull();
    expect(parseLocation({ loc: [] })).toBeNull();
    const junk = { loc: 45 as unknown as string, la: {} as unknown as string };
    expect(parseLocation(junk)).toBeNull();
    expect(parseLocation({ loc: "p:45.035,38.975", la: 7 as unknown as string })?.label).toBeNull();
  });
});

// Геолокация браузера: на десктопе по Wi-Fi или IP точность — сотни метров, и
// точные «350 м» до вещи были бы враньём.
describe("geolocationPoint", () => {
  const coords = { latitude: 45.03512, longitude: 38.97534 };

  it("is exact within the accuracy threshold", () => {
    const p = geolocationPoint({ ...coords, accuracy: GEOLOCATION_EXACT_M }, "улица Красная");
    expect(p).toEqual({
      point: { lat: 45.03512, lon: 38.97534 }, label: "улица Красная", source: "geo", precision: "house",
    });
    expect(locationQuery(p)).toEqual({ loc: "p:45.035,38.975", la: "улица Красная", src: "geo" });
  });

  it("is approximate (lp=s) beyond it", () => {
    const p = geolocationPoint({ ...coords, accuracy: GEOLOCATION_EXACT_M + 1 }, null);
    expect(p.precision).toBe("street");
    expect(locationQuery(p).lp).toBe("s");
  });

  it("trusts a point without a reported accuracy", () => {
    expect(geolocationPoint({ ...coords, accuracy: null }, null).precision).toBe("house");
  });
});
