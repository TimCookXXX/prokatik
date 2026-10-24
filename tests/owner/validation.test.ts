import { describe, it, expect } from "vitest";
import { listingFormSchema } from "@/lib/owner/validation";

const base = {
  title: "Дрель Bosch",
  categoryId: "c1",
  cityId: "city1",
  depositType: "none" as const,
  quantity: 1,
  priceDay: 500,
  priceWeek: "",
  priceMonth: "",
  minDays: "1",
  handoverPickup: true,
  handoverDelivery: false,
  address: { mode: "keep" },
};

describe("listingFormSchema", () => {
  it("requires cityId", () => {
    const r = listingFormSchema.safeParse({ ...base, cityId: "" });
    expect(r.success).toBe(false);
  });

  // Публичную подпись сервер собирает из выбранного адреса сам: поле формы
  // «Район или ориентир» ушло, и присланный ключ просто отбрасывается.
  it("drops location from the form: the server derives it from the address", () => {
    const r = listingFormSchema.safeParse({ ...base, location: "ул. Баумана" });
    expect(r.success).toBe(true);
    expect(r.data).not.toHaveProperty("location");
  });

  // Хоть одна цена из трёх. Пустое поле и ноль разводятся по сообщениям: форма
  // шлёт строки, и «» без обработки стало бы нулём, то есть незаполненная цена
  // жаловалась бы на величину вместо отсутствия.
  it("требует хоть одну цену и отличает пустое поле от нуля", () => {
    // null и пробелы — тоже «не заполнено». Из формы такое не придёт, но
    // payload мутации приходит извне.
    const empty = [{ ...base, priceDay: "" }, { ...base, priceDay: null }, { ...base, priceDay: "   " }];
    for (const input of empty) {
      const r = listingFormSchema.safeParse(input);
      expect(r.success).toBe(false);
      expect(r.error?.issues[0]?.message).toBe("Укажите цену за сутки, неделю или месяц");
    }

    const zero = listingFormSchema.safeParse({ ...base, priceDay: 0 });
    expect(zero.success).toBe(false);
    expect(zero.error?.issues[0]?.message).toBe("Цена должна быть больше нуля");
  });

  // Ключи тарифов обязательны, значения — нет: старая вкладка, где полей
  // недели и месяца ещё нет, шлёт форму без них, и updateListing обнулил бы
  // недельную цену, выставленную в новой. Пусть лучше запрос не пройдёт.
  it("payload без ключей тарифов — устаревшая форма, а не «цены нет»", () => {
    for (const key of ["priceDay", "priceWeek", "priceMonth", "minDays"] as const) {
      const { [key]: _drop, ...without } = base;
      const r = listingFormSchema.safeParse(without);
      expect(r.success).toBe(false);
      expect(r.error?.issues[0]?.message).toBe("Форма устарела — обновите страницу");
    }
  });

  it("только недельная цена — от 7 дней, только месячная — от 30", () => {
    const week = { ...base, priceDay: "", priceWeek: "2250" };
    const short = listingFormSchema.safeParse({ ...week, minDays: "3" });
    expect(short.success).toBe(false);
    expect(short.error?.issues[0]?.message).toBe("Без цены за сутки минимальный срок — от 7 дней");
    const ok = listingFormSchema.safeParse({ ...week, minDays: "7" });
    expect(ok.success).toBe(true);
    expect(ok.data).toMatchObject({ priceDay: null, priceWeek: 2250, priceMonth: null, minDays: 7 });

    const month = { ...base, priceDay: "", priceMonth: "7000" };
    const notMonth = listingFormSchema.safeParse({ ...month, minDays: "7" });
    expect(notMonth.error?.issues[0]?.message).toBe("Без цены за сутки и за неделю минимальный срок — от 30 дней");
    expect(listingFormSchema.safeParse({ ...month, minDays: "30" }).success).toBe(true);
  });

  it("кривая цена — одна ошибка про цену, без лишней про срок", () => {
    const r = listingFormSchema.safeParse({ ...base, priceDay: "", priceWeek: "abc" });
    expect(r.error?.issues.map((i) => i.message)).toEqual(["Цена — целое число рублей"]);
  });

  it("минимальный срок: пусто — один день, вне 1…90 — отказ", () => {
    expect(listingFormSchema.safeParse({ ...base, minDays: "" }).data?.minDays).toBe(1);
    for (const minDays of ["0", "91", "2.5", "abc"]) {
      const r = listingFormSchema.safeParse({ ...base, minDays });
      expect(r.success).toBe(false);
      expect(r.error?.issues[0]?.message).toBe("Минимальный срок — от 1 до 90 дней");
    }
  });

  // Цена приходит из формы строкой — приведение обязано её принять.
  it("принимает цену строкой, как её шлёт форма", () => {
    const r = listingFormSchema.safeParse({ ...base, priceDay: "500" });
    expect(r.success).toBe(true);
    expect(r.data?.priceDay).toBe(500);
  });

  // Объявление, которое нельзя ни забрать, ни получить доставкой, — не
  // объявление. Форма такого не отправит, но payload приходит извне.
  it("не пропускает объявление без единого способа получения", () => {
    const r = listingFormSchema.safeParse({
      ...base, handoverPickup: false, handoverDelivery: false,
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe("Выберите хотя бы один способ получения");
  });

  it("оба способа сразу — валидно", () => {
    const r = listingFormSchema.safeParse({
      ...base, handoverPickup: true, handoverDelivery: true,
    });
    expect(r.success).toBe(true);
  });

  // Дефолта у флагов нет намеренно: updateListing пишет .set() всеми полями,
  // и подстановка «самовывоз без доставки» вместо отсутствующего ключа снимала
  // бы владельцу доставку при правке объявления из устаревшей вкладки.
  // Сообщение при этом другое: галочкой такое не чинится.
  it("payload без способа получения не проходит, а не подставляет самовывоз", () => {
    const { handoverPickup: _p, handoverDelivery: _d, ...withoutHandover } = base;
    const r = listingFormSchema.safeParse(withoutHandover);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe("Форма устарела — обновите страницу");
  });

  // Русское сообщение и на не-boolean: иначе человек увидел бы «Expected
  // boolean, received string» — issues[0].message уходит прямо в интерфейс.
  it("не-boolean тоже отбивается по-русски", () => {
    const r = listingFormSchema.safeParse({ ...base, handoverPickup: "on" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe("Форма устарела — обновите страницу");
  });
});

describe("listingFormSchema: address", () => {
  const pick = {
    mode: "pick", kind: "street", title: "улица Красная", subtitle: "Краснодар", lat: 45.035, lon: 38.975,
  };
  const parse = (address: unknown) => listingFormSchema.safeParse({ ...base, address });
  const message = (address: unknown) => parse(address).error?.issues[0]?.message;

  it("accepts the three variants: keep, pick and text", () => {
    expect(parse({ mode: "keep" }).success).toBe(true);
    expect(parse(pick).data?.address).toEqual(pick);
    expect(parse({ mode: "text", text: "  ул. Баумана " }).data?.address).toEqual({ mode: "text", text: "ул. Баумана" });
  });

  // Тот же приём, что у флагов способа получения: updateListing пишет .set()
  // всеми полями, и молча «оставить как есть» за бандл старой формы нельзя.
  it("a payload without the address key is a stale form, not a kept address", () => {
    const { address: _drop, ...withoutAddress } = base;
    expect(listingFormSchema.safeParse(withoutAddress).error?.issues[0]?.message)
      .toBe("Форма устарела — обновите страницу");
    expect(message(null)).toBe("Форма устарела — обновите страницу");
    expect(message("улица Красная")).toBe("Форма устарела — обновите страницу");
    expect(message({ mode: "teleport" })).toBe("Форма устарела — обновите страницу");
  });

  it("a malformed pick asks to pick from the suggestions", () => {
    expect(message({ ...pick, lat: "45.035" })).toBe("Выберите адрес из подсказок");
    expect(message({ ...pick, lat: 95 })).toBe("Выберите адрес из подсказок");
    expect(message({ ...pick, kind: "planet" })).toBe("Выберите адрес из подсказок");
    expect(message({ ...pick, title: "" })).toBe("Выберите адрес из подсказок");
  });

  it("free text is 3 to 200 characters", () => {
    expect(message({ mode: "text", text: "ул" })).toBe("Адрес — от 3 до 200 символов");
    expect(message({ mode: "text", text: "а".repeat(201) })).toBe("Адрес — от 3 до 200 символов");
    expect(message({ mode: "text" })).toBe("Адрес — от 3 до 200 символов");
  });
});
