// @vitest-environment node
// Очистка адреса и текста перед записью в свою статистику: только разрешённые
// параметры, маска на всём, что пишет человек, личные разделы без id, админки
// нет вовсе.
import { describe, expect, it } from "vitest";
import {
  MAX_PATH_LENGTH, MAX_Q_LENGTH, entryOf, maskText, referrerHost, sanitizePath, sanitizeQuery,
} from "@/lib/analytics/sanitize";
import { WHERE_PARAMS } from "@/lib/search/submit-href";

const enc = encodeURIComponent;

describe("maskText", () => {
  it.each([
    ["почта", "дрель ivan.petrov@mail.ru", "дрель ***"],
    ["ссылка", "смотри https://avito.ru/item/1", "смотри ***"],
    ["www", "www.example.com дрель", "*** дрель"],
    ["ник", "пишите @ivan_petrov", "пишите ***"],
    ["5+ цифр", "заказ 123456", "заказ ***"],
    ["телефон с разделителями", "+7 (918) 123-45-67 дрель", "*** дрель"],
    ["телефон с восьмёрки", "8 918 123 45 67", "***"],
    ["телефон без +7 с разделителями", "перфоратор 912 345-67-89", "перфоратор ***"],
    ["телефон без +7 через дефисы", "дрель 912-345-67-89", "дрель ***"],
    ["телефон без +7 со скобками", "(912) 345 67 89 болгарка", "*** болгарка"],
    ["ссылка без схемы: Telegram", "пишите t.me/ivan", "пишите ***"],
    ["ссылка без схемы: VK", "vk.com/id123 палатка", "*** палатка"],
    ["ссылка без схемы: WhatsApp", "wa.me/79181234567", "***"],
    ["ссылка без схемы: домен", "дрель ivan-prokat.ru/catalog", "дрель ***"],
    ["ссылка без схемы: кириллический домен", "прокат.рф", "***"],
  ])("%s", (_name, input, expected) => {
    expect(maskText(input)).toBe(expected);
  });

  it("модели и размеры остаются", () => {
    expect(maskText("перфоратор makita hr2470 18 в")).toBe("перфоратор makita hr2470 18 в");
    expect(maskText("палатка 4 места 2024")).toBe("палатка 4 места 2024");
    expect(maskText("шуруповёрт 1.5 ач 2 акб")).toBe("шуруповёрт 1.5 ач 2 акб");
    expect(maskText("стол 120x60 см, 2 шт")).toBe("стол 120x60 см, 2 шт");
    expect(maskText("палатка 25-27 октября")).toBe("палатка 25-27 октября");
    expect(maskText("node.js курс")).toBe("node.js курс");
  });
});

describe("sanitizeQuery", () => {
  it("маскирует, схлопывает пробелы и режет по колонке", () => {
    expect(sanitizeQuery("  дрель   89181234567 ")).toBe("дрель ***");
    expect(sanitizeQuery("а".repeat(300))).toHaveLength(MAX_Q_LENGTH);
  });
});

describe("sanitizePath", () => {
  it("главная и каталог", () => {
    expect(sanitizePath("/")).toBe("/");
    expect(sanitizePath("/krasnodar/instrumenty?sort=price_asc&page=2&from=2026-10-10&to=2026-10-12"))
      .toBe("/krasnodar/instrumenty?from=2026-10-10&to=2026-10-12&sort=price_asc&page=2");
  });

  it("на /search — список разрешённых, q маскируется в пути", () => {
    const path = sanitizePath(`/search?q=${enc("дрель 89181234567")}&city=krasnodar&category=tools&view=list&sort=new`);
    expect(path).toBe("/search?q=дрель+***&city=krasnodar&category=tools&sort=new");
  });

  // Кириллица — буквами: путь короче и читается в админке; разбор обратно цел.
  it("query читаемый и разбирается обратно", () => {
    const path = sanitizePath(`/search?q=${enc("a&b=c+d 50%")}&city=krasnodar`)!;
    expect(path).toBe("/search?q=a%26b%3Dc%2Bd+50%25&city=krasnodar");
    expect(new URL(path, "http://x").searchParams.get("q")).toBe("a&b=c+d 50%");
  });

  // «Где» — точка и подпись адреса человека: не пишется ни на /search, ни в каталоге.
  it("все параметры «Где» вырезаются", () => {
    const where = WHERE_PARAMS.map((k) => `${k}=${enc("p:45.03,38.97 ул. Красная, 1")}`).join("&");
    for (const base of ["/search?q=a&city=krasnodar", "/krasnodar/tools?from=2026-10-10&to=2026-10-11", "/"]) {
      const path = sanitizePath(`${base}&${where}`.replace("/&", "/?"))!;
      for (const key of WHERE_PARAMS) expect(new URL(path, "http://x").searchParams.has(key)).toBe(false);
    }
  });

  it("метки кампании, клики рекламы и прочее в путь не идут", () => {
    expect(sanitizePath("/?utm_source=tg&utm_content=x&yclid=123&gclid=4&fbclid=5&foo=bar")).toBe("/");
    expect(sanitizePath("/krasnodar?utm_campaign=autumn")).toBe("/krasnodar");
  });

  it("значения проверяются форматом", () => {
    expect(sanitizePath(`/search?city=${enc("ivan@mail.ru")}&page=abc&from=tomorrow&q=a`)).toBe("/search?q=a");
  });

  it("личные разделы — без id и параметров", () => {
    expect(sanitizePath("/chat/01JABCDEFGHJKMNPQRSTVWXYZ0")).toBe("/chat");
    expect(sanitizePath("/chat/new/01JABCDEFGHJKMNPQRSTVWXYZ0")).toBe("/chat");
    expect(sanitizePath("/cabinet/requests?request=01J")).toBe("/cabinet");
    expect(sanitizePath("/profile")).toBe("/profile");
  });

  it("вход, сброс пароля и прочие страницы — без параметров", () => {
    expect(sanitizePath(`/login?from=${enc("/admin/users")}`)).toBe("/login");
    expect(sanitizePath("/reset?token=secret")).toBe("/reset");
    expect(sanitizePath("/u/01JABCDEFGHJKMNPQRSTVWXYZ0?tab=x")).toBe("/u/01JABCDEFGHJKMNPQRSTVWXYZ0");
  });

  it("админка и служебное не пишутся", () => {
    expect(sanitizePath("/admin")).toBeNull();
    expect(sanitizePath("/admin/visitors/abc")).toBeNull();
    expect(sanitizePath("/api/analytics")).toBeNull();
  });

  it("чужой и битый адрес отклоняется", () => {
    expect(sanitizePath("//evil.com/x")).toBeNull();
    expect(sanitizePath("https://evil.com/")).toBeNull();
    expect(sanitizePath("/\\evil.com")).toBeNull();
    expect(sanitizePath("krasnodar")).toBeNull();
  });

  it("сегмент не похож на слаг — звёздочка", () => {
    expect(sanitizePath(`/krasnodar/${enc("Иван Петров")}`)).toBe("/krasnodar/*");
    expect(sanitizePath("/89181234567")).toBe("/*");
  });

  it("вещь: слаг и ULID — целиком", () => {
    const path = `/krasnodar/instrumenty/${"a".repeat(80)}-01JABCDEFGHJKMNPQRSTVWXYZ0`;
    expect(sanitizePath(path)).toBe(path);
  });

  it("длина — в пределах колонки", () => {
    const path = sanitizePath(`/search?q=${enc("а".repeat(90))}&city=${"c".repeat(80)}&category=${"k".repeat(80)}`)!;
    expect(path.length).toBeLessThanOrEqual(MAX_PATH_LENGTH);
    expect(path.startsWith("/search?q=")).toBe(true);
  });
});

describe("referrerHost", () => {
  it("хост без www и пакет приложения", () => {
    expect(referrerHost("https://www.Google.com/search?q=x")).toBe("google.com");
    expect(referrerHost("android-app://org.telegram.messenger/")).toBe("org.telegram.messenger");
    expect(referrerHost("")).toBeNull();
    expect(referrerHost("javascript:alert(1)")).toBeNull();
    expect(referrerHost("not a url")).toBeNull();
  });
});

describe("entryOf", () => {
  it("разрешённые метки, маска, длина; клик рекламы — флагом", () => {
    const entry = entryOf(
      `/?utm_source=tg&utm_medium=cpc&utm_campaign=${enc("ivan@mail.ru " + "x".repeat(80))}&utm_content=secret&yclid=777`,
      "https://yandex.ru/",
    );
    expect(entry.ref).toBe("yandex.ru");
    expect(entry.ad).toBe("yandex");
    expect(entry.utm.utm_source).toBe("tg");
    expect(entry.utm.utm_medium).toBe("cpc");
    expect(entry.utm.utm_campaign!.startsWith("*** ")).toBe(true);
    expect(entry.utm.utm_campaign!.length).toBeLessThanOrEqual(50);
    expect(JSON.stringify(entry)).not.toContain("secret");
    expect(JSON.stringify(entry)).not.toContain("777");
  });

  it("без меток и referrer'а — пусто", () => {
    expect(entryOf("/krasnodar", undefined)).toEqual({ ref: null, utm: {}, ad: null });
  });
});
