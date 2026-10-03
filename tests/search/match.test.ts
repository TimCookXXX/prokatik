import { describe, expect, it } from "vitest";
import {
  extraWordScore, hasSearchWords, highlight, matchToken, MAX_QUERY_WORDS, queryTokens, stopWordSet, subsets, tokenForms, wordScore,
} from "@/lib/search/match";

describe("wordScore", () => {
  it("ranks exact over prefix over stem over substring over typo", () => {
    expect(wordScore("дрель", "дрель")).toBe(3);
    expect(wordScore("перфо", "перфоратор")).toBe(2.25);
    expect(wordScore("перфоратора", "перфоратор")).toBe(1.9);
    expect(wordScore("ратор", "перфоратор")).toBe(1);
    expect(wordScore("перфаратор", "перфоратор")).toBe(0.8);
  });

  it("no fuzzy jump to unrelated words", () => {
    expect(wordScore("бензорез", "бензогенератор")).toBe(0);
    expect(wordScore("makita", "maikaolin")).toBe(0);
    // Раскладка и транслит — опечатка только против слова целиком.
    expect(wordScore("макс", "макита", true)).toBe(0);
  });

  it("description words match only exactly, by start or by stem", () => {
    expect(extraWordScore("бетон", "бетон")).toBe(3);
    expect(extraWordScore("бето", "бетону")).toBeGreaterThan(2);
    expect(extraWordScore("бетона", "бетону")).toBe(1.9);
    expect(extraWordScore("етон", "бетон")).toBe(0);
    expect(extraWordScore("бетн", "бетон")).toBe(0);
  });
});

describe("queryTokens", () => {
  it("drops service words and names of live cities", () => {
    const stop = stopWordSet(["Краснодар", "Краснодаре"]);
    expect(queryTokens("прокат перфоратора в Краснодаре на выходные", stop)).toEqual(["перфоратора"]);
    expect(queryTokens("дрель краснодар", stop)).toEqual(["дрель"]);
  });

  it("does not hardcode a city", () => {
    expect(queryTokens("дрель краснодар", stopWordSet([]))).toEqual(["дрель", "краснодар"]);
  });

  it("drops a compound city name whole and by words", () => {
    const stop = stopWordSet(["Ростов-на-Дону", null]);
    expect(queryTokens("каяк ростов-на-дону", stop)).toEqual(["каяк"]);
    expect(queryTokens("каяк ростов", stop)).toEqual(["каяк"]);
  });

  it("keeps service words when nothing else is left", () => {
    expect(queryTokens("прокат", stopWordSet([]))).toEqual(["прокат"]);
  });

  // Каждое слово — проход по словарю города на общем потоке: потолок держит
  // цену длинного запроса.
  it("takes at most MAX_QUERY_WORDS words", () => {
    const q = Array.from({ length: 300 }, (_, i) => `дрел${i}`).join(" ");
    expect(queryTokens(q, stopWordSet([]))).toHaveLength(MAX_QUERY_WORDS);
    expect(queryTokens("прокат аренда в на для до с от", stopWordSet([]))).toHaveLength(MAX_QUERY_WORDS);
  });
});

describe("hasSearchWords", () => {
  it("is false for service words and city names only", () => {
    const stop = stopWordSet(["Казань", "Казани"]);
    expect(hasSearchWords("прокат", stop)).toBe(false);
    expect(hasSearchWords("прокат в Казани", stop)).toBe(false);
    expect(hasSearchWords("прокат дрели в Казани", stop)).toBe(true);
  });
});

describe("tokenForms", () => {
  const parts = (raw: string) => tokenForms(raw).map((f) => f.parts.join(" "));

  it("adds layout, transliteration, look-alikes and the joined article", () => {
    expect(parts("gthajhfnjh")).toContain("перфоратор");
    expect(parts("perforator")).toContain("перфоратор");
    expect(parts("НR2470")).toContain("hr2470");
    expect(parts("gbh2-26")).toContain("gbh226");
  });

  it("adds synonyms with a lower weight, also for word forms and wrong layout", () => {
    const forms = tokenForms("болгарку");
    expect(forms.find((f) => f.parts.join(" ") === "ушм")?.weight).toBe(0.9);
    expect(forms.some((f) => f.parts.join(" ") === "угловая шлифмашина")).toBe(true);
    expect(parts(",jkufhrf")).toContain("ушм");
    expect(parts("велики")).toContain("велосипед");
  });

  it("expands a word still being typed into differently spelled synonyms", () => {
    const forms = tokenForms("керх");
    expect(forms.find((f) => f.parts.join(" ") === "karcher")?.weight).toBeCloseTo(0.72);
    expect(parts("керх")).not.toContain("керхер");
    expect(parts("бол")).not.toContain("ушм");
  });

  it("a word being typed is not a short synonym: «перфо» is not «перф»", () => {
    expect(parts("перфо")).not.toContain("перфоратор");
    expect(parts("перф")).toContain("перфоратор");
  });
});

describe("matchToken", () => {
  const entry = { own: ["ушм", "makita"], context: ["электроинструменты", "инструменты"], extra: ["бетон"] };

  it("takes the best form; context weighs 0.6", () => {
    expect(matchToken(tokenForms("ушм"), entry, false)).toEqual({ score: 3, own: true });
    expect(matchToken(tokenForms("болгарка"), entry, false)?.score).toBeCloseTo(2.7);
    expect(matchToken(tokenForms("инструменты"), entry, false)).toEqual({ score: expect.closeTo(1.8), own: false });
  });

  it("description counts only when asked", () => {
    expect(matchToken(tokenForms("бетон"), entry, false)).toBeNull();
    expect(matchToken(tokenForms("бетон"), entry, true)?.score).toBeCloseTo(1.05);
  });
});

describe("subsets", () => {
  it("lists combinations in order", () => {
    expect(subsets(["a", "b", "c"], 2)).toEqual([["a", "b"], ["a", "c"], ["b", "c"]]);
    expect(subsets(["a", "b"], 3)).toEqual([]);
  });
});

describe("highlight", () => {
  it("marks matched word starts, also for converted forms", () => {
    expect(highlight("Перфоратор SDS-plus", "перфо")[0]).toEqual({ text: "Перфо", hit: true });
    expect(highlight("Makita HR2470", "макит")[0]).toEqual({ text: "Makit", hit: true });
    expect(highlight("Перфоратор", "gthaj")[0]).toEqual({ text: "Перфо", hit: true });
  });

  it("marks synonyms", () => {
    expect(highlight("УШМ Makita", "болгарка")[0]).toEqual({ text: "УШМ", hit: true });
  });

  it("empty query — nothing marked", () => {
    expect(highlight("Дрель", " ")).toEqual([{ text: "Дрель", hit: false }]);
  });
});
