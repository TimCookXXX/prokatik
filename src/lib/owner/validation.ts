// Валидация формы товара кабинета.

import { z } from "zod";

const priceField = z.union([z.literal(""), z.coerce.number().int().min(0).max(10_000_000)])
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : v));

// Цена за сутки обязательна и строго больше нуля. preprocess сводит все формы
// «не заполнено» к undefined, чтобы они дошли до required_error: форма шлёт
// строки, а z.coerce.number() превращает и "", и " ", и null в ноль — человек
// с пустым полем получил бы «должна быть больше нуля» вместо «укажите цену».
// Ноль запрещён намеренно: это старое «цены нет» в новой обёртке — такое
// объявление утянуло бы вниз границу фильтра цены на весь раздел и уехало бы
// в разметку для поисковиков как «бесплатно».
const priceDayField = z.preprocess(
  (v) => (v === null || v === undefined || (typeof v === "string" && v.trim() === "")
    ? undefined
    : v),
  z.coerce.number({
    required_error: "Укажите цену за сутки",
    invalid_type_error: "Укажите цену за сутки",
  })
    .int("Цена — целое число рублей")
    .min(1, "Цена должна быть больше нуля")
    .max(10_000_000, "Слишком большая цена"),
);

const handoverField = z.boolean({
  required_error: "Форма устарела — обновите страницу",
  invalid_type_error: "Форма устарела — обновите страницу",
});

export const listingFormSchema = z.object({
  title: z.string().trim().min(3, "Название от 3 символов").max(200),
  categoryId: z.string().min(1, "Выберите категорию"),
  cityId: z.string().min(1, "Выберите город"),
  description: z.string().trim().max(3000).optional().default(""),
  location: z.string().trim().max(120).optional().default(""),  // район/ориентир, опц.
  priceDay: priceDayField,
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
});

export type ListingForm = z.output<typeof listingFormSchema>;

// Слаги, зарезервированные под маршруты приложения. Проверяет их создание
// города (adminCreateCity): слаг города — первый сегмент адреса и не должен
// перекрывать статический маршрут. Разделам проверка не нужна — под /{city}/
// статических соседей нет.
export const RESERVED_SLUGS = new Set([
  "api", "admin", "cabinet", "requests", "login", "reset", "welcome", "banned",
  "privacy", "dev", "u", "chat", "profile", "search", "sources",
  "sitemap.xml", "robots.txt", "manifest.webmanifest",
]);
