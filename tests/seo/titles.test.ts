import { describe, expect, it } from "vitest";
import {
  CATALOG_TITLE_MAX, DESCRIPTION_MAX, LISTING_TITLE_MAX, catalogDescription, catalogHeading, catalogTitle, cityTitle,
  listingDescription, listingShareText, listingTitle, lowerFirst, truncateWords,
} from "@/lib/seo/titles";

// Цены форматируются с неразрывными пробелами; сравнение — по обычным.
const plain = (s: string) => s.replace(/ /g, " ");

const krasnodar = { name: "Краснодар", nameLocative: "Краснодаре" };
const kazan = { name: "Казань", nameLocative: null };

describe("lowerFirst", () => {
  it("строчит первую букву обычного имени", () => {
    expect(lowerFirst("Экшн-камеры")).toBe("экшн-камеры");
  });
  it("оставляет аббревиатуру как есть", () => {
    expect(lowerFirst("VR")).toBe("VR");
    expect(lowerFirst("SUP-доски")).toBe("SUP-доски");
  });
  it("не падает на коротком и пустом", () => {
    expect(lowerFirst("")).toBe("");
    expect(lowerFirst("Я")).toBe("я");
  });
});

describe("truncateWords", () => {
  it("короткую строку не трогает, пробелы схлопывает", () => {
    expect(truncateWords("  Дрель   Bosch ", 20)).toBe("Дрель Bosch");
  });
  it("режет по слову и ставит «…» в пределах лимита", () => {
    const out = truncateWords("Палатка четырёхместная туристическая с тамбуром", 30);
    expect(out).toBe("Палатка четырёхместная…");
    expect(out.length).toBeLessThanOrEqual(30);
  });
  it("снимает знак препинания перед «…»", () => {
    expect(truncateWords("Палатка, четырёхместная туристическая", 12)).toBe("Палатка…");
  });
  it("не кончается на предлоге или союзе", () => {
    expect(truncateWords("Детский электросамокат, до 50 кг", 28)).toBe("Детский электросамокат…");
    expect(truncateWords("Сварочный инвертор для дома и дачи", 26)).toBe("Сварочный инвертор…");
  });
  it("слово, кончающееся ровно на границе, остаётся", () => {
    // «Палатка четырёхместная» — 22 символа, лимит 23: место для «…» есть.
    expect(truncateWords("Палатка четырёхместная туристическая", 23)).toBe("Палатка четырёхместная…");
  });
  it("неразрывный пробел цены не схлопывается и не режется", () => {
    const price = "1 500 ₽";
    expect(truncateWords(`Цена ${price}`, 40)).toBe(`Цена ${price}`);
    // Раньше «1 500» рвалось по пробелу: «Аренда от 1…».
    expect(truncateWords(`Аренда от ${price} в сутки`, 15)).toBe("Аренда…");
    expect(truncateWords(`Аренда от ${price} в сутки`, 18)).toBe(`Аренда от ${price}…`);
  });
  it("одно слово длиннее лимита режется посимвольно", () => {
    expect(truncateWords("Сверхдлинноеслово", 8)).toBe("Сверхдл…");
  });
});

const dayFrom = (min: number) => ({ unit: "day" as const, min, max: min });

describe("заголовки разделов", () => {
  it("H1 и title по шаблону, регистр имени сохранён", () => {
    expect(catalogHeading("VR", krasnodar)).toBe("VR — аренда и прокат в Краснодаре");
    expect(plain(catalogTitle("VR", krasnodar, dayFrom(1000)))).toBe("VR — аренда и прокат в Краснодаре, от 1 000 ₽/сутки");
  });
  it("без цены — без хвоста «от»", () => {
    expect(catalogTitle("Экшн-камеры", krasnodar, null)).toBe("Экшн-камеры — аренда и прокат в Краснодаре");
  });

  it("drops the price when the title would exceed the limit", () => {
    const long = catalogTitle("Аксессуары для электроники", krasnodar, dayFrom(1200));
    expect(long).toBe("Аксессуары для электроники — аренда и прокат в Краснодаре");
    expect(long.length).toBeLessThanOrEqual(CATALOG_TITLE_MAX);
  });
  it("город без падежа — «· Казань», без « ,»", () => {
    const title = catalogTitle("Дрели", kazan, dayFrom(500));
    expect(plain(title)).toBe("Дрели — аренда и прокат · Казань, от 500 ₽/сутки");
    expect(title).not.toContain(" ,");
  });
  it("описание из данных: счётчики, раздел строчной, диапазон цен", () => {
    const d = catalogDescription("Экшн-камеры", krasnodar, {
      listingCount: 12, ownerCount: 5, price: { unit: "day", min: 700, max: 1500 },
    });
    expect(plain(d)).toBe(
      "12 позиций, 5 продавцов: экшн-камеры напрокат в Краснодаре, от 700 ₽ до 1 500 ₽/сутки. Залог, даты и заявка на бронь онлайн.",
    );
    expect(d.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });
  it("одна цена — без «от … до»", () => {
    const d = catalogDescription("VR", krasnodar, { listingCount: 1, ownerCount: 1, price: dayFrom(1000) });
    expect(plain(d)).toContain("1 позиция, 1 продавец: VR напрокат в Краснодаре, 1 000 ₽/сутки.");
  });
  it("пустой раздел — описание без чисел", () => {
    const d = catalogDescription("Коляски", kazan, { listingCount: 0, ownerCount: 0, price: null });
    expect(d).toBe("Коляски напрокат · Казань: цены, залоги и календарь занятости. Залог, даты и заявка на бронь онлайн.");
  });
  // Суточных в разделе нет — цена со своей единицей, а не выдуманная доля.
  it("раздел без суточных — «от 2 250 ₽/неделя»", () => {
    const week = { unit: "week" as const, min: 2250, max: 3000 };
    expect(plain(catalogTitle("Электровелосипеды", krasnodar, week)))
      .toBe("Электровелосипеды — аренда и прокат в Краснодаре, от 2 250 ₽/неделя");
    const d = catalogDescription("Электровелосипеды", krasnodar, { listingCount: 3, ownerCount: 2, price: week });
    expect(plain(d)).toContain("от 2 250 ₽ до 3 000 ₽/неделя.");
  });
  it("витрина города", () => {
    expect(plain(cityTitle(krasnodar, dayFrom(150)))).toBe("Аренда и прокат вещей в Краснодаре — от 150 ₽/сутки");
    expect(cityTitle(kazan, null)).toBe("Аренда и прокат вещей · Казань");
  });
});

const day = (priceDay: number) => ({ priceDay, priceWeek: null, priceMonth: null });

describe("listingTitle", () => {
  it("короткое название — целиком, с городом и ценой", () => {
    expect(plain(listingTitle("Дрель Bosch", krasnodar, day(700)))).toBe("Дрель Bosch — аренда в Краснодаре, 700 ₽/сутки");
  });

  it("длинное название режется по слову, хвост с городом и ценой цел, ≤ 65", () => {
    const t = listingTitle("Виброшлифмашина Makita BO3711 с пылесборником и запасными листами", { name: "Яблоновский", nameLocative: "Яблоновском" }, day(1500));
    expect(t.length).toBeLessThanOrEqual(LISTING_TITLE_MAX);
    expect(plain(t)).toMatch(/^Виброшлифмашина Makita[^—]*… — аренда в Яблоновском, 1 500 ₽\/сутки$/);
    // Обрезка именно по слову: перед «…» — целое слово названия.
    const head = t.split("…")[0]!;
    expect("Виброшлифмашина Makita BO3711 с пылесборником и запасными листами".startsWith(head)).toBe(true);
    expect([" ", undefined]).toContain("Виброшлифмашина Makita BO3711 с пылесборником и запасными листами"[head.length]);
  });

  it("город без падежа — «· Казань», без « ,»", () => {
    const t = listingTitle("Палатка", kazan, day(500));
    expect(plain(t)).toBe("Палатка — аренда · Казань, 500 ₽/сутки");
    expect(t).not.toContain(" ,");
  });

  it("город с очень длинным именем не съедает название", () => {
    const long = { name: "Петропавловск-Камчатский", nameLocative: "Петропавловске-Камчатском районного подчинения" };
    const t = listingTitle("Лодка надувная ПВХ с мотором", long, day(3000));
    expect(t.length).toBeLessThanOrEqual(LISTING_TITLE_MAX);
    expect(t.startsWith("Лодка надувная")).toBe(true);
  });

  it("текст «Поделиться» — та же фраза без обрезки", () => {
    const title = "Виброшлифмашина Makita BO3711 с пылесборником и запасными листами";
    expect(plain(listingShareText(title, krasnodar, day(300)))).toBe(`${title} — аренда в Краснодаре, 300 ₽/сутки`);
  });

  it("без суточной — главная цена со своей единицей, а не выдуманная доля", () => {
    const week = { priceDay: null, priceWeek: 2250, priceMonth: 7000 };
    expect(plain(listingTitle("Электровелосипед Kugoo", krasnodar, week)))
      .toBe("Электровелосипед Kugoo — аренда в Краснодаре, 2 250 ₽/неделя");
    expect(plain(listingShareText("Электровелосипед", krasnodar, { ...week, priceWeek: null })))
      .toBe("Электровелосипед — аренда в Краснодаре, 7 000 ₽/месяц");
  });
});

describe("listingDescription", () => {
  const base = {
    title: "Дрель", description: null as string | null,
    priceDay: 700 as number | null, priceWeek: null as number | null, priceMonth: null, minDays: 1,
    depositType: "none" as const, depositAmount: null as number | null,
    handoverPickup: true, handoverDelivery: false,
  };

  it("сначала факты: цена, залог, получение", () => {
    expect(plain(listingDescription(base, krasnodar))).toBe("Аренда в Краснодаре: 700 ₽/сутки, без залога, самовывоз.");
  });

  it("денежный залог с суммой и доставка", () => {
    const d = listingDescription({ ...base, depositType: "money", depositAmount: 5000, handoverDelivery: true }, kazan);
    expect(plain(d)).toBe("Аренда · Казань: 700 ₽/сутки, залог 5 000 ₽, самовывоз или доставка.");
  });

  it("залог без суммы не выдаётся за «не указан»", () => {
    const d = listingDescription({ ...base, depositType: "money", depositAmount: null }, krasnodar);
    expect(plain(d)).toBe("Аренда в Краснодаре: 700 ₽/сутки, самовывоз.");
  });

  it("минимальный срок — после цены, единица — главной цены", () => {
    const d = listingDescription({ ...base, priceDay: null, priceWeek: 2250, minDays: 7 }, krasnodar);
    expect(plain(d)).toBe("Аренда в Краснодаре: 2 250 ₽/неделя, от 7 дней, без залога, самовывоз.");
  });

  it("потом текст владельца, всё вместе ≤ 160 с обрезкой по слову", () => {
    const own = "Мощная ударная дрель. ".repeat(20);
    const d = listingDescription({ ...base, description: own }, krasnodar);
    expect(d.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(d.startsWith("Аренда в Краснодаре: 700")).toBe(true);
    expect(d.endsWith("…")).toBe(true);
    expect(d).toContain("без залога, самовывоз. Мощная ударная дрель.");
  });
});
