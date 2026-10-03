// Поле адреса со своим геокодером (src/lib/geo/address.ts, precision.ts):
// подписи, точность подсказки, сверка хитов, порядок ответов сервера при
// наборе, список без мигания. Перенос генеричной части
// sravniprokat/tests/compare/address.test.ts — без справочника мест «Где».
import { describe, expect, it } from "vitest";
import { content } from "@theme/content";
import {
  hitKey, hitLabel, needsServer, publicLabel, reverseLabel, sameHit, sameTyping, shouldApply, suggestNear,
  visibleAddresses, type AddressHit,
} from "@/lib/geo/address";
import { isApprox, isCoarsePlace, listingPrecision, precisionNote } from "@/lib/geo/precision";
import { createClientGeocoder, buildClientIndex, createGeocoder } from "@/lib/geocoder";
import { FIXTURE } from "../geocoder/fixture";

function hit(p: Partial<AddressHit> & Pick<AddressHit, "title">): AddressHit {
  return {
    id: p.title, kind: "house", subtitle: "Краснодар", lat: 45.03, lon: 38.97, precision: "house", score: 100,
    parts: { place: "Краснодар", street: "улица Красная", house: "120" }, ...p,
  };
}

const house = hit({ title: "улица Красная, 120" });
const yab = hit({
  title: "улица Базовская, 21к1", subtitle: "Яблоновский",
  parts: { place: "Яблоновский", street: "улица Базовская", house: "21к1" },
});
const between = hit({
  title: "улица Ставропольская, ≈106", kind: "street", precision: "street",
  parts: { place: "Краснодар", street: "улица Ставропольская", house: null },
});
const street = hit({
  title: "улица Красная", kind: "street", precision: "street",
  parts: { place: "Краснодар", street: "улица Красная", house: null },
});
const place = hit({
  title: "Яблоновский", kind: "place", precision: "place", subtitle: "посёлок",
  parts: { place: "Яблоновский", street: null, house: null },
});
const ymr = hit({
  title: "Юбилейный", kind: "place", precision: "place", subtitle: "микрорайон, Краснодар",
  parts: { place: "Юбилейный", street: null, house: null },
});
const city = hit({
  title: "Краснодар", kind: "place", precision: "place", subtitle: "город",
  parts: { place: "Краснодар", street: null, house: null },
});
const okrug = hit({
  title: "Прикубанский округ", kind: "place", precision: "place", subtitle: "округ, Краснодар",
  parts: { place: "Прикубанский округ", street: null, house: null },
});
const poi = hit({
  title: "ЖК Панорама", kind: "poi", precision: "house", subtitle: "улица Красная, 120",
  parts: { place: "Краснодар", street: null, house: null },
});

describe("precision of a suggestion", () => {
  it("a house (also interpolated) is exact; a missing number or a street is «≈ до улицы»", () => {
    expect(listingPrecision(house)).toBe("house");
    expect(listingPrecision({ kind: "house", precision: "interpolated", subtitle: "Краснодар" })).toBe("house");
    expect(listingPrecision(between)).toBe("street");
    expect(listingPrecision({ kind: "house", precision: "street", subtitle: "Краснодар" })).toBe("street");
    expect(listingPrecision(street)).toBe("street");
  });

  it("a POI (ЖК, ТЦ) is approximate, unlike sravniprokat: it covers a block", () => {
    expect(listingPrecision(poi)).toBe("place");
  });

  it("a microdistrict, a town, a village, an SNT are «≈ населённый пункт»", () => {
    expect(listingPrecision(place)).toBe("place");
    expect(listingPrecision(ymr)).toBe("place");
    expect(listingPrecision({ kind: "place", precision: "place", subtitle: "садовое товарищество" })).toBe("place");
    expect(listingPrecision({ kind: "place", precision: "place", subtitle: "хутор" })).toBe("place");
  });

  it("a whole city or okrug is rejected — a distance to its centre would be a false number", () => {
    expect(listingPrecision(city)).toBeNull();
    expect(listingPrecision(okrug)).toBeNull();
    expect(isCoarsePlace(city)).toBe(true);
    expect(isCoarsePlace(okrug)).toBe(true);
    expect(isCoarsePlace(ymr)).toBe(false);
    // улица с подзаголовком-городом — не пункт
    expect(isCoarsePlace(street)).toBe(false);
  });

  it("the engine and the mini index label a city so that it is recognised as coarse", () => {
    const server = createGeocoder(structuredClone(FIXTURE));
    const client = createClientGeocoder(buildClientIndex(structuredClone(FIXTURE)));
    for (const g of [server, client]) {
      const krd = g.suggest("краснодар", { limit: 3 }).find((h) => h.kind === "place" && h.title === "Краснодар");
      expect(krd && isCoarsePlace(krd)).toBe(true);
      const yub = g.suggest("юмр", { limit: 3 })[0];
      expect(yub.title).toBe("Юбилейный");
      expect(listingPrecision(yub)).toBe("place");
    }
  });

  it("«≈» for anything but a house", () => {
    expect(isApprox("house")).toBe(false);
    expect(isApprox("street")).toBe(true);
    expect(isApprox("place")).toBe(true);
    expect(isApprox("city")).toBe(true);
  });
});

describe("precision notes", () => {
  it("«Где»: short, none for a house", () => {
    expect(precisionNote("house", "where")).toBeNull();
    expect(precisionNote("street", "where")).toBe("≈ до улицы");
    expect(precisionNote("place", "where", "place")).toBe("≈ населённый пункт");
    expect(precisionNote("place", "where", "poi")).toBe(content.address.note.where.poi);
  });

  it("place of unknown kind (saved address): a note true for a settlement and a ЖК alike", () => {
    expect(precisionNote("place", "listing")).toBe(content.address.note.listing.area);
    expect(precisionNote("place", "where")).toBe(content.address.note.where.area);
    expect(precisionNote("place", "listing")).not.toMatch(/населённый пункт|объекта/);
  });

  it("listing form: says what buyers will see, a house included", () => {
    expect(precisionNote("house", "listing")).toBe(content.address.note.listing.house);
    expect(precisionNote("house", "listing")).toContain("не номер");
    expect(precisionNote("street", "listing")).toMatch(/^≈ до улицы — /);
    expect(precisionNote("place", "listing", "place")).toMatch(/^≈ населённый пункт — /);
  });

  it("no point — no note", () => {
    expect(precisionNote(null, "listing")).toBeNull();
    expect(precisionNote("city", "where")).toBeNull();
  });
});

describe("labels", () => {
  it("adds the settlement outside the listing's city", () => {
    expect(hitLabel(house, "Краснодар")).toBe("улица Красная, 120");
    expect(hitLabel(yab, "Краснодар")).toBe("улица Базовская, 21к1, Яблоновский");
    expect(hitLabel(yab, "Яблоновский")).toBe("улица Базовская, 21к1");
    expect(hitLabel(place, "Краснодар")).toBe("Яблоновский");
  });

  it("a house addressed by its settlement does not repeat the settlement", () => {
    const snt = hit({ title: "СНТ Кубаночка, 1", parts: { place: "СНТ Кубаночка", street: null, house: "1" } });
    expect(hitLabel(snt, "Краснодар")).toBe("СНТ Кубаночка, 1");
  });

  it("public label never has a house number", () => {
    expect(publicLabel(house, "Краснодар")).toBe("улица Красная");
    expect(publicLabel(yab, "Краснодар")).toBe("улица Базовская, Яблоновский");
    expect(publicLabel(yab, "Яблоновский")).toBe("улица Базовская");
    expect(publicLabel(between, "Краснодар")).toBe("улица Ставропольская");
    expect(publicLabel(street, "Краснодар")).toBe("улица Красная");
    // объект — название, а не его адрес с домом из подзаголовка
    expect(publicLabel(poi, "Краснодар")).toBe("ЖК Панорама");
    expect(publicLabel(ymr, "Краснодар")).toBe("Юбилейный");
    // дом по пункту, без улицы («СНТ Кубаночка, 15») — пункт
    const snt = hit({ title: "СНТ Кубаночка, 15", parts: { place: "СНТ Кубаночка", street: null, house: "15" } });
    expect(publicLabel(snt, "Краснодар")).toBe("СНТ Кубаночка");
  });

  it("public label of real engine hits has no digits for houses", () => {
    const g = createGeocoder(structuredClone(FIXTURE));
    for (const q of ["красная 120", "базовская 21к1", "ставропольская 106"]) {
      const h = g.suggest(q, { limit: 1 })[0];
      expect(publicLabel(h, "Краснодар")).not.toMatch(/\d/);
    }
  });

  it("geolocation: a house — its address, otherwise «рядом»", () => {
    expect(reverseLabel(house, "Краснодар")).toBe("улица Красная, 120");
    expect(reverseLabel(street, "Краснодар")).toBe("рядом: улица Красная");
    expect(reverseLabel(null, "Краснодар")).toBeNull();
  });
});

describe("same hit: browser pick vs the server's own search", () => {
  const server = { ...street, id: "s:s-krasnaya" };

  it("ids differ (mini index cs0 vs server s:…) — matched by kind, text and point", () => {
    const mini: AddressHit = { ...street, id: "cs0" };
    expect(sameHit(mini, server)).toBe(true);
    expect(hitKey(mini)).toBe(hitKey(server));
  });

  it("text is compared normalized: case, ё, punctuation", () => {
    expect(sameHit({ ...server, title: "Улица КРАСНАЯ", subtitle: "краснодар" }, server)).toBe(true);
    expect(sameHit({ ...place, title: "Яблоновский", subtitle: "посёлок" }, { ...place, subtitle: "поселок" })).toBe(true);
  });

  // Район движок дописывает, только когда в том же списке есть тёзка: у
  // мини-индекса «Краснодар», у сервера — «Краснодар, Авиагородок».
  it("a district tail added to the subtitle on one side is the same address", () => {
    expect(sameHit(server, { ...server, subtitle: "Краснодар, Авиагородок" })).toBe(true);
    expect(sameHit({ ...server, subtitle: "Краснодар, Авиагородок" }, server)).toBe(true);
    expect(sameHit({ ...server, subtitle: "Краснодар, ЗИП" }, { ...server, subtitle: "Краснодар, Авиагородок" })).toBe(false);
  });

  it("a point moved further than 50 m is a forged pick", () => {
    expect(sameHit({ ...server, lat: server.lat + 0.0003 }, server)).toBe(true); // ≈ 33 м
    expect(sameHit({ ...server, lat: server.lat + 0.0006 }, server)).toBe(false); // ≈ 67 м
  });

  it("another kind, title or subtitle is another address", () => {
    expect(sameHit({ ...server, kind: "house" }, server)).toBe(false);
    expect(sameHit({ ...server, title: "улица Красина" }, server)).toBe(false);
    expect(sameHit({ ...server, subtitle: "Яблоновский" }, server)).toBe(false);
  });

  it("a mini-index street is found again by the server engine", () => {
    const client = createClientGeocoder(buildClientIndex(structuredClone(FIXTURE)));
    const engine = createGeocoder(structuredClone(FIXTURE));
    const picked = client.suggest("ставропольск", { limit: 1 })[0];
    const again = engine.suggest(`${picked.title} ${picked.subtitle}`, { near: picked, limit: 10 });
    expect(again.some((h) => sameHit(picked, h))).toBe(true);
  });
});

describe("near point for address suggestions", () => {
  const centre = { lat: 44.988, lon: 38.9475 };
  const picked = { lat: 45.03, lon: 38.97 };
  const stored = { lat: 45.01, lon: 38.93 };

  it("the chosen point, else the last place from this device, else the city centre", () => {
    expect(suggestNear(picked, stored, centre)).toEqual(picked);
    expect(suggestNear(null, stored, centre)).toEqual(stored);
    expect(suggestNear(null, null, centre)).toEqual(centre);
  });
});

describe("server requests while typing", () => {
  it("asks the server for houses only; streets come from the mini index", () => {
    expect(needsServer("красная", true)).toBe(false);
    expect(needsServer("красная 1", true)).toBe(true);
    expect(needsServer("красная", false)).toBe(true);
    expect(needsServer("к", false)).toBe(false);
  });

  it("drops replies older than the shown one and replies to text the user has left", () => {
    expect(shouldApply({ seq: 3, q: "красная 12" }, 2, "красная 12")).toBe(true);
    expect(shouldApply({ seq: 2, q: "красная 1" }, 3, "красная 12")).toBe(false); // пришёл после более нового
    expect(shouldApply({ seq: 4, q: "красная 1" }, 3, "красная 12")).toBe(true); // начало набираемого — лучше прошлого
    expect(shouldApply({ seq: 5, q: "красная 12" }, 4, "красная 1")).toBe(false); // текст уже стёрли
  });
});

describe("visible list does not blink", () => {
  const streets = [street];
  const houses = [house];

  it("the server reply to exactly this text wins", () => {
    expect(visibleAddresses("красная 120", { q: "Красная 120", items: houses }, streets)).toBe(houses);
  });

  it("while a number is typed, previous houses stay instead of falling back to streets", () => {
    expect(visibleAddresses("красная 120", { q: "красная 12", items: houses }, streets)).toBe(houses);
  });

  it("without a number — the mini index at once", () => {
    expect(visibleAddresses("красн", { q: "крас", items: houses }, streets)).toBe(streets);
  });

  it("without the mini index — the previous server list until a new one comes", () => {
    expect(visibleAddresses("красная 1", { q: "красная", items: streets }, null)).toBe(streets);
    expect(visibleAddresses("красная", null, null)).toEqual([]);
  });

  it("the field was cleared and another text is typed — the old list is not shown even for a moment", () => {
    expect(visibleAddresses("кр", { q: "базовская 21к1", items: [yab] }, null)).toEqual([]);
    expect(sameTyping("базовская 21к1", "кр")).toBe(false);
    expect(sameTyping("крас", "красн")).toBe(true);
    expect(sameTyping("красная 12", "красная 1")).toBe(true); // стёрли с конца
  });
});
