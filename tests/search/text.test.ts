import { describe, expect, it } from "vitest";
import {
  compact, editDistance, fixHomoglyphs, normalize, stem, switchLayout, transliterate, words,
} from "@/lib/search/text";

describe("normalize", () => {
  it("lowercases, folds ё and strips punctuation", () => {
    expect(normalize("  Проёмы, SDS-plus!  ")).toBe("проемы sds plus");
  });

  it("splits into words and joins articles", () => {
    expect(words("Перфоратор Bosch GBH 2-26", null, "Шуруповёрт")).toEqual(["перфоратор", "bosch", "gbh", "2", "26", "шуруповерт"]);
    expect(compact("Puzzi 8/1")).toBe("puzzi81");
  });
});

describe("layout and transliteration", () => {
  it("switches layout both ways", () => {
    expect(switchLayout("gthajhfnjh")).toBe("перфоратор");
    expect(switchLayout("gepb")).toBe("пузи");
    expect(switchLayout("ьфлшеф")).toBe("makita");
  });

  it("transliterates both ways", () => {
    expect(transliterate("пузи")).toBe("puzi");
    expect(transliterate("perforator")).toBe("перфоратор");
    expect(transliterate("макита")).toBe("makita");
  });
});

describe("stem", () => {
  it("strips Russian endings, keeping at least four letters", () => {
    expect(stem("перфоратора")).toBe("перфоратор");
    expect(stem("перфораторы")).toBe("перфоратор");
    expect(stem("моющего")).toBe("моющ");
    expect(stem("дрели")).toBe("дрел");
  });

  it("leaves short and Latin words alone", () => {
    expect(stem("дрель")).toBe("дрель");
    expect(stem("makita")).toBe("makita");
  });
});

describe("fixHomoglyphs", () => {
  it("turns Cyrillic look-alikes Latin only next to Latin", () => {
    expect(fixHomoglyphs("НR2470")).toBe("HR2470");
    expect(fixHomoglyphs("перфоратор")).toBe("перфоратор");
  });
});

// Полная матрица, как в sravniprokat: три строки обязаны давать то же.
function matrixDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

describe("editDistance", () => {
  it("counts a swap of neighbours as one edit", () => {
    expect(editDistance("перфаратор", "перфоратор", 2)).toBe(1);
    expect(editDistance("пефроратор", "перфоратор", 2)).toBe(1);
    expect(editDistance("бензорез", "бензоген", 1)).toBe(2);
  });

  it("matches the full-matrix version", () => {
    const alphabet = "абвгр";
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const word = () => Array.from({ length: Math.floor(rnd() * 9) }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join("");
    for (let i = 0; i < 3000; i++) {
      const a = word();
      const b = word();
      const max = Math.floor(rnd() * 4);
      expect(editDistance(a, b, max), `${a} ${b} ${max}`).toBe(matrixDistance(a, b, max));
    }
  });
});
