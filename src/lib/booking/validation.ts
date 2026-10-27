// Валидация формы заявки на бронь. Телефон обязателен (без СМС-верификации
// в v1), нормализуется к +7XXXXXXXXXX для российских номеров.

import { z } from "zod";

// Убирает всё кроме цифр и ведущего +; 8XXXXXXXXXX приводит к +7.
export function normalizePhone(raw: string): string {
  const stripped = raw.replace(/[^\d+]/g, "");
  const plusless = stripped.startsWith("+") ? stripped.slice(1) : stripped;
  if (!/^\d{10,15}$/.test(plusless)) return "";
  if (plusless.length === 11 && (plusless.startsWith("8") || plusless.startsWith("7"))) {
    return `+7${plusless.slice(1)}`;
  }
  return `+${plusless}`;
}

/* Цена, показанная в момент выбора: undefined — поле не прислано (старый
 * клиент, сверки нет), null — «этой цены у вещи нет», число — сама цена. */
const snapshotPrice = z.preprocess(
  (v) => (v === null || (typeof v === "string" && v.trim() === "") ? null : v),
  z.coerce.number().int().positive().nullable().optional(),
);

/* Выбор на странице вещи: объявление, даты, количество и увиденные цены. Общая
 * часть заявки из кабинета, черновика для бота и запасной формы — их проверяет
 * одна функция (checkBookingSelection), и разойтись входам нельзя. */
export const bookingSelectionSchema = z.object({
  listingId: z.string().min(1),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  qty: z.coerce.number().int().min(1).max(1000),
  /* Цена за сутки, показанная в момент выбора. Ездит с формой не ради расчёта —
   * сервер считает сам, — а чтобы поймать её сдвиг: заявка замораживает условия
   * у себя, и заморозить их полагается теми, на которые человек соглашался.
   * Та же роль, что у qty, и та же проверка (см. price_stale).
   *
   * НЕОБЯЗАТЕЛЬНА намеренно. Страница, открытая до выкладки этого поля, шлёт
   * форму без него, и обязательное поле рвало бы бронь всем, кто не
   * перезагрузился, — молча и с английским текстом зода вместо объяснения.
   * Пропуск безопасен: снимок в заявку кладётся из объявления в любом случае,
   * клиент на него не влияет. Без цены теряется только предупреждение о её
   * сдвиге — ровно то поведение, что было до этого поля. */
  priceDay: snapshotPrice,
  /* Недельная и месячная — той же сверкой. Пустая строка значит «у вещи этой
   * цены нет», и сверяется тоже: появившаяся за время открытой формы недельная
   * цена меняет сумму так же, как поднятая суточная. */
  priceWeek: snapshotPrice,
  priceMonth: snapshotPrice,
});

export type BookingSelectionInput = z.input<typeof bookingSelectionSchema>;
export type BookingSelectionData = z.output<typeof bookingSelectionSchema>;

export const bookingFormSchema = bookingSelectionSchema.extend({
  phone: z.string().transform(normalizePhone).refine((p) => p.length > 0, {
    message: "Укажите телефон в формате +7 900 000-00-00",
  }),
  comment: z.string().trim().max(500).optional().default(""),
  // Honeypot: скрытое поле, люди его не заполняют. Непустое значение — бот.
  website: z.string().optional().default(""),
});

export type BookingFormInput = z.input<typeof bookingFormSchema>;
export type BookingForm = z.output<typeof bookingFormSchema>;
