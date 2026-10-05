import { describe, expect, it } from "vitest";
import { houseKey, displayHouse } from "@/lib/geocoder/house-number";
import { chunkVariants, tokenize } from "@/lib/geocoder/query";
import { layoutToRu, nameWords, numeralWord, phoneticKey, stemWord, translitToRu } from "@/lib/geocoder/text";
import { damerau, prefixDamerau } from "@/lib/geocoder/fuzzy";

const kinds = (q: string) => tokenize(q, false).map((t) => `${t.kind}:${t.text}`);

describe("раскладка и транслит", () => {
  it("английская раскладка вместе со знаками на месте русских букв", () => {
    expect(layoutToRu(",fpjdcrfz")).toBe("базовская");
    expect(layoutToRu("Rhfcyfz")).toBe("красная");
    expect(layoutToRu("<fhfytyrj")).toBe("бараненко"); // Shift: «<» — «Б»
    expect(layoutToRu("L.Yt[fz", true)).toBe("д.нехая");
  });

  it("транслит адресов", () => {
    expect(translitToRu("krasnaya")).toBe("красная");
    expect(translitToRu("ulitsa")).toBe("улица");
    expect(translitToRu("Pervomayskiy")).toBe("первомайский");
    // мягкого знака в латинице нет — «ставрополская» находится опечаткой (см. engine.test)
    expect(translitToRu("Stavropolskaya")).toBe("ставрополская");
    expect(translitToRu("5-y")).toBe("5-й");
  });

  it("у кусков в латинице есть варианты «раскладка» и «транслит»", () => {
    const [chunk] = chunkVariants("Gentdfz,");
    expect(chunk.map((v) => v.text)).toEqual(expect.arrayContaining(["путевая,", "путеваяб"]));
    expect(chunkVariants("Красная 5")[0]).toHaveLength(1);
  });
});

describe("номер дома", () => {
  it("корпус, строение, литера и буква — один ключ", () => {
    for (const s of ["21к1", "21 к1", "21 корп.1", "21 к.1", "21, корпус 1", "21 корп 1"]) expect(houseKey(s)).toBe("21к1");
    for (const s of ["7Б", "7 б", "7-Б", '7"Б"', "7б"]) expect(houseKey(s)).toBe("7б");
    expect(houseKey("12 стр. 2")).toBe(houseKey("12с2"));
    expect(houseKey("97 лит. Л")).toBe("97литл");
    expect(houseKey("78/1A")).toBe("78/1а"); // латинская «A»
    expect(houseKey("174\\3")).toBe("174/3");
    expect(houseKey("482-483")).toBe("482-483");
  });

  it("в запросе номер собирается из частей", () => {
    expect(kinds("Базовская 21 корп 1")).toEqual(["w:базовская", "h:21к1"]);
    expect(kinds("Базовская 21 к.1")).toEqual(["w:базовская", "h:21к1"]);
    expect(kinds("Базовская 21к1")).toEqual(["w:базовская", "h:21к1"]);
    expect(kinds("Ленина 7 б")).toEqual(["w:ленина", "h:7б"]);
    expect(kinds("Ленина 7-Б")).toEqual(["w:ленина", "h:7б"]);
    expect(kinds("Ленина 21/1")).toEqual(["w:ленина", "h:21/1"]);
    expect(kinds("Ленина 12 стр 2")).toEqual(["w:ленина", "h:12с2"]);
    expect(kinds('Школьная 10"А"')).toEqual(["w:школьная", "h:10а"]);
    expect(kinds("Есенина 22/Б")).toEqual(["w:есенина", "h:22/б"]);
  });

  it("квартира, офис, этаж и индекс выбрасываются", () => {
    expect(kinds("Рабочая 1Г кв 224")).toEqual(["w:рабочая", "h:1г"]);
    expect(kinds("Рабочая, 1, офис 5, 3 этаж")).toEqual(["w:рабочая", "n:1"]);
    expect(kinds("350000, Красная 5")).toEqual(["w:красная", "n:5"]);
  });

  it("буква перед названием пункта — тип пункта, а не литера", () => {
    const t = tokenize("улица Светлая 58, а. Козет", false);
    expect(t.find((x) => x.kind === "n" || x.kind === "h")?.text).toBe("58");
  });

  it("«д.» помечает номер дома", () => {
    const t = tokenize("пгт Яблоновский, ул Базовская, д. 21 корп 1", false);
    const h = t.find((x) => x.kind === "h");
    expect(h?.text).toBe("21к1");
    expect(h?.houseMarker).toBe(true);
  });

  it("показ номера", () => {
    expect(displayHouse("7 б")).toBe("7Б");
    expect(displayHouse("21 корп 1")).toBe("21к1");
  });
});

describe("числительные и названия", () => {
  it("порядковые числа — часть названия, а не дом", () => {
    expect(kinds("1-й Линейный проезд 5")).toEqual(["o:1", "w:линейный", "w:проезд", "n:5"]);
    expect(kinds("ул. 7я Линия, д. 186")).toEqual(["w:ул", "o:7", "w:линия", "w:д", "n:186"]);
    expect(kinds("40-летия Победы 12")).toEqual(["o:40", "w:лет", "w:победы", "n:12"]);
    expect(kinds("первого Мая 5")).toEqual(["o:1", "w:мая", "n:5"]);
  });

  it("числительные словами", () => {
    expect(numeralWord("первого")).toBe("1");
    expect(numeralWord("сорок")).toBe("40");
    expect(numeralWord("красная")).toBeNull();
  });

  it("слова названия: тип и «летия» приводятся", () => {
    expect(nameWords("улица 40-летия Победы")).toEqual(["улица", "40", "лет", "победы"]);
    expect(nameWords("1-й Линейный проезд")).toEqual(["1", "линейный", "проезд"]);
    expect(nameWords("СНТ «Лесное»")).toEqual(["снт", "лесное"]);
  });

  it("сокращения типов через дефис", () => {
    expect(kinds("пр-т Чекистов 5")).toEqual(["w:прт", "w:чекистов", "n:5"]);
    expect(tokenize("пр-т Чекистов", false)[0].fn).toBe("street-type");
    expect(tokenize("ст-ца Елизаветинская", false)[0].fn).toBe("place-type");
    expect(tokenize("с/т Кубаночка", false)[0].fn).toBe("place-type");
  });
});

describe("падежи, фонетика, опечатки", () => {
  it("основа одинакова у падежных форм", () => {
    expect(stemWord("красной")).toBe(stemWord("красная"));
    expect(stemWord("ставропольской")).toBe(stemWord("ставропольская"));
    expect(stemWord("базовскую")).toBe(stemWord("базовская"));
  });

  it("фонетический ключ сводит частые ошибки на слух", () => {
    expect(phoneticKey("кутузава")).toBe(phoneticKey("кутузова"));
    expect(phoneticKey("совхознае")).toBe(phoneticKey("совхозная"));
  });

  it("Дамерау–Левенштейн с перестановкой и отсечкой", () => {
    expect(damerau("базовкая", "базовская", 2)).toBe(1);
    expect(damerau("рашпилвеская", "рашпилевская", 2)).toBe(1); // перестановка
    expect(damerau("красная", "садовая", 2)).toBe(3); // больше max — max + 1
    expect(prefixDamerau("кабзекск", "казбекская", 1)).toBe(1);
  });
});
