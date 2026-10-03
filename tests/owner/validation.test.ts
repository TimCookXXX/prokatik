import { describe, it, expect } from "vitest";
import { listingFormSchema } from "@/lib/owner/validation";

const base = {
  title: "Дрель Bosch",
  categoryId: "c1",
  cityId: "city1",
  depositType: "none" as const,
  quantity: 1,
  priceDay: 500,
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

  // Цена за сутки — единственная: аренда посуточная, других тарифов у брони
  // нет. Пустое поле и ноль разводятся по сообщениям: форма шлёт строки, и
  // «» без обработки стало бы нулём, то есть незаполненная цена жаловалась бы
  // на величину вместо отсутствия.
  it("требует цену за сутки и отличает пустое поле от нуля", () => {
    const { priceDay: _p, ...withoutPrice } = base;
    // null и пробелы — тоже «не заполнено»: Number() сводит их к нулю, и без
    // обработки человек получил бы жалобу на величину вместо отсутствия.
    // Из формы такое не придёт, но payload мутации приходит извне.
    const empty = [withoutPrice, { ...base, priceDay: "" }, { ...base, priceDay: null },
      { ...base, priceDay: "   " }];
    for (const input of empty) {
      const r = listingFormSchema.safeParse(input);
      expect(r.success).toBe(false);
      expect(r.error?.issues[0]?.message).toBe("Укажите цену за сутки");
    }

    const zero = listingFormSchema.safeParse({ ...base, priceDay: 0 });
    expect(zero.success).toBe(false);
    expect(zero.error?.issues[0]?.message).toBe("Цена должна быть больше нуля");
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
