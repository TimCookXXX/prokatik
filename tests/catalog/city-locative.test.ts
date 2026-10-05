import { describe, it, expect } from "vitest";
import { headingCity, suggestLocative } from "@/lib/catalog/city-locative";

// Правило — подсказка для админки, а не источник правды: результат человек
// подтверждает глазами, и хранится он потом колонкой. Поэтому тест проверяет,
// что на распространённых формах подсказка попадает точно, а на редких — не
// падает и выдаёт что-то осмысленное.
describe("suggestLocative", () => {
  it("declines the plain endings", () => {
    expect(suggestLocative("Казань")).toBe("Казани");   // -ь → -и
    expect(suggestLocative("Пермь")).toBe("Перми");
    expect(suggestLocative("Москва")).toBe("Москве");   // -а → -е
    expect(suggestLocative("Уфа")).toBe("Уфе");
    expect(suggestLocative("Тула")).toBe("Туле");
    expect(suggestLocative("Новосибирск")).toBe("Новосибирске"); // согласная → +е
    expect(suggestLocative("Волгоград")).toBe("Волгограде");
  });

  // Литературная норма склоняет: «в Иванове», а не «в Иваново».
  it("declines the -ово/-ево/-ино names", () => {
    expect(suggestLocative("Иваново")).toBe("Иванове");
    expect(suggestLocative("Кемерово")).toBe("Кемерове");
  });

  it("declines plural names", () => {
    expect(suggestLocative("Мытищи")).toBe("Мытищах");
    expect(suggestLocative("Люберцы")).toBe("Люберцах");
  });

  // Ровно тот случай, ради которого правилу нельзя доверять молча: каждое слово
  // склоняется отдельно, и прилагательное — не так, как существительное.
  it("declines every word of a multi-word name", () => {
    expect(suggestLocative("Нижний Новгород")).toBe("Нижнем Новгороде");
    expect(suggestLocative("Великий Новгород")).toBe("Великом Новгороде");
    expect(suggestLocative("Набережные Челны")).toBe("Набережных Челнах");
    expect(suggestLocative("Белая Калитва")).toBe("Белой Калитве");
  });

  // В дефисных названиях склоняется последняя часть...
  it("declines only the last part of a hyphenated name", () => {
    expect(suggestLocative("Санкт-Петербург")).toBe("Санкт-Петербурге");
    expect(suggestLocative("Гусь-Хрустальный")).toBe("Гусь-Хрустальном");
  });

  // ...кроме «-на-реке»: там, наоборот, склоняется первая, а хвост неподвижен.
  it("declines the head of a -на- name and leaves the tail alone", () => {
    expect(suggestLocative("Ростов-на-Дону")).toBe("Ростове-на-Дону");
    expect(suggestLocative("Комсомольск-на-Амуре")).toBe("Комсомольске-на-Амуре");
  });

  it("survives what it cannot decline", () => {
    expect(suggestLocative("")).toBe("");
    expect(suggestLocative("   ")).toBe("");
    expect(suggestLocative("Сочи")).toBe("Сочах"); // неверно, но правится руками
  });
});

// Город во фразе один на все места: с падежом — «в Казани», без — «· Казань».
// Именительный после «в» не подставляется, запятая перед городом не ставится.
describe("headingCity", () => {
  it("с падежом — предлог и падеж", () => {
    expect(headingCity({ name: "Казань", nameLocative: "Казани" })).toBe("в Казани");
  });
  it("без падежа — «· Город», без запятой", () => {
    expect(headingCity({ name: "Казань", nameLocative: null })).toBe("· Казань");
  });
});
