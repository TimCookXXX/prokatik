// Дерево категорий — справочник, а не демо-данные: на слаги отсюда завязаны
// адреса каталога. Живёт отдельным модулем, потому что заводить его должен
// каждый сид, и оба обязаны работать на чистой базе поодиночке. Раньше дерево
// лежало внутри scripts/seed.ts вперемешку с демо-городом, и второй сид не мог
// подняться, не притащив Казань.
//
// vertical у подкатегории тот же, что у корня, — грубая группировка ниш.
// Явный slug задаётся там, где он не выводится из имени: «Аксессуары к одежде»
// и «Аксессуары для электроники» когда-то назывались одинаково «Аксессуары», и
// адреса с тех пор держат прежние слаги — менять их значит ломать ссылки.
//
// keywords — слова, по которым поиск «Что» относит вещь к разделу: «химчистка»
// находит всё из «Уборочной техники». Совпадение по ним получает каждое
// объявление раздела, поэтому сюда идут слова про раздел целиком, а не названия
// отдельных вещей: «дрель» у «Электроинструментов» вывела бы на «дрель» и
// болгарку, и лобзик. Равнозначные названия одной вещи («болгарка» = «ушм») —
// в src/lib/search/synonyms.ts. В БД слов нет: дерево задано здесь, поиск
// берёт их по слагу, и разделу из админки они не достаются, пока их не впишут.

import { slugify } from "@/lib/slugify";

export interface SeedCategoryChild {
  name: string;
  /** Если не задан — slugify(name). */
  slug?: string;
  /** Слова поиска, относящие вещь к разделу. */
  keywords?: string[];
}

export interface SeedCategoryRoot {
  name: string;
  vertical: string;
  keywords?: string[];
  children: SeedCategoryChild[];
}

export const SEED_CATEGORIES: SeedCategoryRoot[] = [
  {
    name: "Инструменты", vertical: "tools",
    children: [
      { name: "Электроинструменты", keywords: ["электроинструмент"] },
      { name: "Ручной инструмент" },
      { name: "Садовая техника", keywords: ["сад", "садовый", "дача", "огород"] },
      { name: "Строительное оборудование", keywords: ["стройка", "строительство", "ремонт"] },
    ],
  },
  {
    name: "Одежда", vertical: "clothing",
    children: [
      { name: "Вечерняя одежда", keywords: ["платье", "выпускной"] },
      { name: "Свадебная одежда", keywords: ["свадьба", "платье"] },
      { name: "Костюмы", keywords: ["костюм", "карнавальный", "маскарад"] },
      { name: "Аксессуары к одежде", slug: "aksessuary-odezhda" },
    ],
  },
  {
    name: "Фото и видео", vertical: "photo",
    children: [
      { name: "Камеры", keywords: ["фотоаппарат", "камера"] },
      { name: "Объективы" },
      { name: "Освещение", keywords: ["свет", "осветитель"] },
      { name: "Штативы и стабилизаторы", keywords: ["штатив", "трипод"] },
      { name: "Дроны", keywords: ["дрон", "квадрокоптер"] },
      { name: "Экшн-камеры", keywords: ["камера"] },
    ],
  },
  {
    name: "Транспорт", vertical: "transport",
    children: [
      { name: "Велосипеды", keywords: ["велосипед"] },
      { name: "Электросамокаты", keywords: ["самокат", "электросамокат"] },
      { name: "Автомобили", keywords: ["авто", "машина", "автомобиль"] },
      { name: "Прицепы", keywords: ["прицеп"] },
      { name: "Водный транспорт", keywords: ["лодка"] },
    ],
  },
  {
    name: "Туризм и отдых", vertical: "outdoor", keywords: ["туризм", "поход"],
    children: [
      { name: "Палатки", keywords: ["кемпинг", "поход"] },
      { name: "Спальники", keywords: ["спальный мешок", "поход"] },
      { name: "Рюкзаки", keywords: ["поход"] },
      { name: "Кемпинг-оборудование", keywords: ["кемпинг", "поход"] },
      { name: "Туристическая посуда" },
    ],
  },
  {
    name: "Развлечения", vertical: "entertainment",
    children: [
      { name: "Игровые приставки", keywords: ["приставка", "консоль"] },
      { name: "VR", keywords: ["виртуальная реальность"] },
      { name: "Настольные игры" },
      { name: "Проекторы", keywords: ["проектор", "кино"] },
    ],
  },
  {
    name: "Детские товары", vertical: "kids", keywords: ["детский", "ребенок"],
    children: [
      { name: "Коляски", keywords: ["коляска"] },
      { name: "Автокресла", keywords: ["автокресло", "автолюлька"] },
      { name: "Игрушки", keywords: ["игрушка"] },
      { name: "Стульчики для кормления", keywords: ["стульчик", "кормление"] },
    ],
  },
  {
    name: "Дом и мероприятия", vertical: "home", keywords: ["мероприятие", "праздник"],
    children: [
      { name: "Мебель" },
      { name: "Декор", keywords: ["праздник", "украшение", "оформление"] },
      { name: "Шатры и тенты", keywords: ["шатер", "тент", "навес"] },
      { name: "Грили и барбекю", keywords: ["мангал", "гриль", "шашлык", "пикник"] },
      { name: "Уборочная техника", keywords: ["уборка", "химчистка", "клининг"] },
    ],
  },
  {
    name: "Электроника", vertical: "electronics",
    children: [
      { name: "Ноутбуки" },
      { name: "Планшеты" },
      { name: "Смартфоны" },
      { name: "Мониторы" },
      { name: "Аксессуары для электроники", slug: "aksessuary-elektronika", keywords: ["гаджет"] },
    ],
  },
  {
    name: "Спорт", vertical: "sport",
    children: [
      { name: "Тренажеры", keywords: ["тренажер", "фитнес"] },
      { name: "Фитнес-инвентарь" },
      { name: "Зимний спорт", keywords: ["лыжи", "сноуборд", "коньки"] },
      { name: "Велоспорт" },
      { name: "Водный спорт", keywords: ["серфинг", "плавание"] },
    ],
  },
];

/** Разделитель пути в CSV: «Инструменты / Электроинструменты». */
export const CATEGORY_PATH_SEPARATOR = "/";

/** Канонический вид пути — по нему сверяются ячейки CSV. */
export function categoryPath(root: string, child: string): string {
  return `${root} ${CATEGORY_PATH_SEPARATOR} ${child}`;
}

/**
 * Разбирает ячейку `category` в пару имён. Пробелы вокруг разделителя
 * необязательны: человек в таблице напишет и «Инструменты/Ручной инструмент».
 */
export function parseCategoryPath(raw: string): { root: string; child: string } | null {
  const parts = raw.split(CATEGORY_PATH_SEPARATOR).map((p) => p.trim()).filter(Boolean);
  if (parts.length !== 2) return null;
  return { root: parts[0], child: parts[1] };
}

/** Все пути дерева — и для сверки, и для подсказки в сообщении об ошибке. */
export function allCategoryPaths(): string[] {
  return SEED_CATEGORIES.flatMap((root) =>
    root.children.map((child) => categoryPath(root.name, child.name)));
}

const KEYWORDS_BY_SLUG = new Map<string, string[]>(SEED_CATEGORIES.flatMap((root) => [
  [slugify(root.name), root.keywords ?? []] as const,
  ...root.children.map((c) => [c.slug ?? slugify(c.name), c.keywords ?? []] as const),
]));

/** Слова поиска раздела по слагу; раздел не из дерева — без слов. */
export function categoryKeywords(slug: string): readonly string[] {
  return KEYWORDS_BY_SLUG.get(slug) ?? [];
}

/** Есть ли такой путь в дереве. */
export function hasCategoryPath(raw: string): boolean {
  const parsed = parseCategoryPath(raw);
  if (!parsed) return false;
  const root = SEED_CATEGORIES.find((r) => r.name === parsed.root);
  return root ? root.children.some((c) => c.name === parsed.child) : false;
}
