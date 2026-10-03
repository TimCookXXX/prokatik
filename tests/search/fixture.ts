// Фикстура поиска «Что»: заголовки из seed_real/listings.csv (плюс пара своих —
// дрель и УШМ, чтобы проверить формы слова и синонимы) на настоящем дереве
// категорий. Описания короткие и свои: на них проверяется поле `extra`.

import { SEED_CATEGORIES, categoryPath } from "@/lib/seed/categories";
import { slugify } from "@/lib/slugify";
import { buildListingIndex, type IndexCategory, type IndexListing } from "@/lib/search/listing-index";

export const CATEGORIES: IndexCategory[] = SEED_CATEGORIES.flatMap((root) => {
  const rootSlug = slugify(root.name);
  return [
    { id: rootSlug, parentId: null, name: root.name, slug: rootSlug },
    ...root.children.map((c) => {
      const slug = c.slug ?? slugify(c.name);
      return { id: slug, parentId: rootSlug, name: c.name, slug };
    }),
  ];
});

const byPath = new Map(SEED_CATEGORIES.flatMap((root) => root.children.map((c) =>
  [categoryPath(root.name, c.name), c.slug ?? slugify(c.name)] as const)));

const TOOLS = "Инструменты / Электроинструменты";
const BUILD = "Инструменты / Строительное оборудование";
const GARDEN = "Инструменты / Садовая техника";
const CLEAN = "Дом и мероприятия / Уборочная техника";

// [заголовок, раздел, описание]
const SOURCE: [string, string, string?][] = [
  ["Перфоратор Bosch GBH 2-26 DFR", TOOLS, "В кейсе три бура по бетону, зубило и запасные щётки."],
  ["Шуруповёрт Makita DF333D с двумя АКБ", TOOLS, "Две батареи на 2 Ач, комплект бит."],
  ["Болгарка DeWalt 125 мм", TOOLS, "Под круг 125, ручка перекидная."],
  ["Лобзик Bosch PST 900 PEL", TOOLS, "Пилит ЛДСП, фанеру, тонкий металл."],
  ["Виброшлифмашина Makita BO3711", TOOLS],
  ["Сварочный инвертор Ресанта САИ-190", TOOLS],
  ["Перфоратор Makita HR2470", TOOLS, "Три режима, бур в комплекте."],
  ["Дрель ударная Интерскол ДУ-13/780ЭР", TOOLS],
  ["УШМ Makita 9558HN", TOOLS],
  ["Лазерный уровень Bosch, 3 линии 360°", "Инструменты / Ручной инструмент"],
  ["Набор инструментов, 108 предметов", "Инструменты / Ручной инструмент"],
  ["Стремянка алюминиевая, 8 ступеней", BUILD],
  ["Мойка высокого давления Karcher K5", CLEAN, "Моет машину и дорожки."],
  ["Бензопила Stihl MS 180", GARDEN],
  ["Триммер электрический 1200 Вт", GARDEN],
  ["Газонокосилка бензиновая Husqvarna LC 140", GARDEN],
  ["Электросамокат Ninebot Max G30", "Транспорт / Электросамокаты"],
  ["Горный велосипед Trek Marlin 5, рама M", "Транспорт / Велосипеды"],
  ["Городской велосипед с корзиной", "Транспорт / Велосипеды"],
  ["Электровелосипед с запасом хода 70 км", "Транспорт / Велосипеды"],
  ["Коляска-трость лёгкая, 6 кг", "Детские товары / Коляски"],
  ["Автокресло 9–18 кг, группа 1", "Детские товары / Автокресла"],
  ["Вечернее платье в пол, размер 42–44", "Одежда / Вечерняя одежда"],
  ["Свадебное платье А-силуэт, 44", "Одежда / Свадебная одежда"],
  ["Сапборд надувной 10'8″ с веслом", "Спорт / Водный спорт"],
  ["Каяк надувной двухместный", "Транспорт / Водный транспорт"],
  ["Бетономешалка 130 л", BUILD],
  ["Генератор бензиновый 3 кВт", BUILD],
  ["Вышка-тура, рабочая высота 4 м", BUILD],
  ["Мангал разборный с шампурами", "Дом и мероприятия / Грили и барбекю"],
  ["Моющий пылесос Karcher SE 4001", CLEAN, "Чистит диван и ковры."],
  ["Пароочиститель Karcher SC 3", CLEAN],
  ["Палатка четырёхместная Naturehike с тамбуром", "Туризм и отдых / Палатки"],
  ["Стабилизатор DJI RS 3 Mini", "Фото и видео / Штативы и стабилизаторы"],
  ["PlayStation 5 с двумя джойстиками", "Развлечения / Игровые приставки"],
];

export interface FixtureListing extends IndexListing {
  slug: string;
}

const DAY = 86_400_000;

export const ROWS: FixtureListing[] = SOURCE.map(([title, path, description], i) => {
  const categoryId = byPath.get(path);
  if (!categoryId) throw new Error(`нет раздела ${path}`);
  return {
    id: `L${String(i).padStart(2, "0")}`,
    slug: slugify(title),
    title,
    description: description ?? null,
    categoryId,
    // Позже в списке — новее: при равной оценке выше.
    createdAt: new Date(Date.UTC(2026, 0, 1) + i * DAY),
  };
});

export const CITY_NAMES = ["Краснодар", "Краснодаре", "Яблоновский", "Яблоновском"];

export function countsOf(rows: readonly IndexListing[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.categoryId, (out.get(r.categoryId) ?? 0) + 1);
  return out;
}

export function fixtureIndex(rows: readonly FixtureListing[] = ROWS, cityNames = CITY_NAMES) {
  return buildListingIndex(rows, CATEGORIES, countsOf(rows), cityNames);
}
