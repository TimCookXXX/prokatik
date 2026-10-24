// Валидация формы товара кабинета.

import { z } from "zod";
import { content } from "@theme/content";
import { MIN_DAYS_MAX, requiredMinDays } from "@/lib/catalog/tariff";

const priceField = z.union([z.literal(""), z.coerce.number().int().min(0).max(10_000_000)])
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : v));

const P = content.tariff;

// Цена срока. Пустое поле — «за этот срок не сдаю» (null); отсутствующий ключ
// — бандл формы, где поля ещё не было: updateListing пишет .set() всеми
// полями, и молча обнулить недельную цену за старую вкладку нельзя — пусть
// лучше запрос не пройдёт (тот же приём, что у handover).
// Ноль запрещён намеренно: это старое «цены нет» в новой обёртке — такое
// объявление утянуло бы вниз границу фильтра цены на весь раздел и уехало бы
// в разметку для поисковиков как «бесплатно».
//
// Разбор руками, а не z.coerce: тот превращает и отсутствующий ключ, и пустую
// строку в NaN или ноль, и человек с пустым полем получил бы «должна быть
// больше нуля», а старая вкладка — «целое число» вместо «обновите страницу».
const isBlank = (v: unknown) => v === null || (typeof v === "string" && v.trim() === "");

const tariffPrice = z.any().transform((v, ctx): number | null => {
  const fail = (message: string) => {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    return z.NEVER;
  };
  if (v === undefined) return fail(P.stale);
  if (isBlank(v)) return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : NaN;
  if (!Number.isInteger(n)) return fail(P.priceInteger);
  if (n < 1) return fail(P.pricePositive);
  if (n > 10_000_000) return fail(P.priceTooBig);
  return n;
});

// Минимальный срок: пусто — один день, как у всех объявлений до этого поля.
const minDaysField = z.any().transform((v, ctx): number => {
  const fail = (message: string) => {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    return z.NEVER;
  };
  if (v === undefined) return fail(P.stale);
  if (isBlank(v)) return 1;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > MIN_DAYS_MAX) return fail(P.minDaysRange);
  return n;
});

const handoverField = z.boolean({
  required_error: "Форма устарела — обновите страницу",
  invalid_type_error: "Форма устарела — обновите страницу",
});

const T = content.address.listing;

// Адрес получения (docs/decisions/0021). Три варианта:
//  - keep — правка, поле адреса не трогали: сохранённые адрес и точка
//    остаются как есть, без похода в геокодер;
//  - pick — выбрана подсказка. Координаты здесь — заявка браузера, а не
//    истина: сервер находит тот же адрес у себя и пишет свою точку
//    (src/server/listing-address.ts);
//  - text — город без геоданных: адрес текстом, точки нет.
// Ключа нет вовсе — это бандл формы, где поля адреса ещё не было: updateListing
// пишет .set() всеми полями, и молча «оставить как есть» за него нельзя.
const pickedAddress = z.object({
  mode: z.literal("pick"),
  kind: z.enum(["house", "street", "place", "poi"], { message: T.pickFromList }),
  title: z.string({ message: T.pickFromList }).trim().min(1, T.pickFromList).max(300, T.pickFromList),
  subtitle: z.string({ message: T.pickFromList }).trim().max(300, T.pickFromList),
  lat: z.number({ message: T.pickFromList }).min(-90, T.pickFromList).max(90, T.pickFromList),
  lon: z.number({ message: T.pickFromList }).min(-180, T.pickFromList).max(180, T.pickFromList),
});

export const listingAddressSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("keep") }),
  pickedAddress,
  z.object({
    mode: z.literal("text"),
    text: z.string({ message: T.textLength }).trim().min(3, T.textLength).max(200, T.textLength),
  }),
], {
  // Сообщение самого объединения: ключа нет, это не объект или вариант
  // неизвестен. Всё это шлёт не человек, а форма другой версии.
  errorMap: () => ({ message: T.stale }),
});

export type ListingAddressInput = z.output<typeof listingAddressSchema>;
export type PickedAddress = z.output<typeof pickedAddress>;

export const listingFormSchema = z.object({
  title: z.string().trim().min(3, "Название от 3 символов").max(200),
  categoryId: z.string().min(1, "Выберите категорию"),
  cityId: z.string().min(1, "Выберите город"),
  description: z.string().trim().max(3000).optional().default(""),
  address: listingAddressSchema,
  // Ключ суточной был всегда, старая вкладка его шлёт; пустое значение больше
  // не ошибка само по себе — достаточно недели или месяца.
  priceDay: tariffPrice,
  priceWeek: tariffPrice,
  priceMonth: tariffPrice,
  minDays: minDaysField,
  depositType: z.enum(["money", "document", "none"]),
  depositAmount: priceField,
  quantity: z.coerce.number().int().min(1).max(1000),
  // Способ получения. Флаги обязательные, без дефолтов: updateListing пишет
  // .set() всеми полями, и подстановка «самовывоз без доставки» вместо
  // отсутствующего ключа молча снимала бы владельцу доставку при любой правке
  // объявления из устаревшей вкладки. Пусть лучше запрос не пройдёт.
  // Сообщения разные не для красоты: «оба сняты» человек чинит галочкой, а
  // отсутствующий ключ шлёт бандл, в форме которого этого поля ещё нет, — там
  // единственное лечение перезагрузить страницу.
  handoverPickup: handoverField,
  handoverDelivery: handoverField,
  photos: z.array(z.object({
    url: z.string().url(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })).max(10).default([]),
}).refine((v) => v.handoverPickup || v.handoverDelivery, {
  message: "Выберите хотя бы один способ получения",
  path: ["handoverPickup"],
}).superRefine((v, ctx) => {
  // Правило согласованности (ADR 0026): срок короче ступени, у которой нет
  // цены, посчитать нечем. Тот же CHECK стоит в базе — listings_min_days_priced.
  // Поле, не прошедшее разбор, уже дало свою ошибку; zod всё равно доходит
  // сюда, и без проверки вторая ошибка была бы про срок, а не про цену.
  const parsed = (x: unknown) => x === null || typeof x === "number";
  if (![v.priceDay, v.priceWeek, v.priceMonth, v.minDays].every(parsed)) return;
  if (v.priceDay === null && v.priceWeek === null && v.priceMonth === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: P.priceRequired, path: ["priceDay"] });
    return;
  }
  const need = requiredMinDays(v);
  if (v.minDays < need) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: v.priceWeek === null ? P.minDaysNoWeek : P.minDaysNoDay,
      path: ["minDays"],
    });
  }
});

export type ListingForm = z.output<typeof listingFormSchema>;

// Слаги, зарезервированные под маршруты приложения. Проверяет их создание
// города (adminCreateCity): слаг города — первый сегмент адреса и не должен
// перекрывать статический маршрут. Разделам проверка не нужна — под /{city}/
// статических соседей нет.
export const RESERVED_SLUGS = new Set([
  "api", "admin", "cabinet", "requests", "login", "reset", "welcome", "banned",
  "privacy", "dev", "u", "chat", "profile", "search", "sources",
  "sitemap.xml", "robots.txt", "manifest.webmanifest", "opengraph-image",
]);
