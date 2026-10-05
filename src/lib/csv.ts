// Парсер CSV по RFC 4180. Своя реализация, а не зависимость: CSV читает один
// скрипт сидов, и тянуть ради него пакет в прод-бандл незачем.
//
// Что обязательно нужно уметь на наших данных: закавыченные поля с запятыми
// внутри (описания объявлений), удвоенную кавычку `""` как экранированную
// (Numbers выдаёт её, как только в тексте появится обычная кавычка) и BOM,
// который дописывает Excel. Незакрытая кавычка и расхождение числа колонок с
// шапкой — ошибка, а не повод угадывать: сдвиг колонок после ручной правки
// иначе прошёл бы молча и перепутал бы описание с адресом.

export class CsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvError";
  }
}

export type CsvRow = Record<string, string>;

/** Разбор в матрицу ячеек. Строки нумеруются с единицы, как в редакторе. */
function splitRecords(input: string): string[][] {
  // BOM снимаем до разбора: иначе он прилипнет к имени первой колонки шапки,
  // и `row["slug"]` вернёт undefined на файле, который на вид верный.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;

  const endField = () => { row.push(field); field = ""; };
  const endRow = () => { endField(); records.push(row); row = []; };

  while (i < text.length) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }

    if (ch === '"' && field === "") { quoted = true; i += 1; continue; }
    if (ch === ",") { endField(); i += 1; continue; }
    if (ch === "\r") { if (text[i + 1] === "\n") i += 1; endRow(); i += 1; continue; }
    if (ch === "\n") { endRow(); i += 1; continue; }

    field += ch; i += 1;
  }

  if (quoted) throw new CsvError("незакрытая кавычка в конце файла");
  // Хвост без перевода строки на конце — тоже запись. Пустой хвост (файл
  // кончился переводом строки) записью не считаем.
  if (field !== "" || row.length > 0) endRow();

  return records;
}

/**
 * Пустая строка. Не только `[""]`: экспорт из редактора таблиц часто оставляет
 * в конце строки из одних запятых — они по числу колонок валидны, и без этой
 * проверки человек получил бы «title пустой» вместо «удалите пустую строку».
 */
const isBlank = (cells: string[]) => cells.every((c) => c.trim() === "");

/**
 * Разбирает CSV в объекты по шапке. Значения обрезаются по краям: файл правит
 * человек в таблице, и случайный пробел после запятой не должен становиться
 * частью слага.
 */
export function parseCsv(input: string): CsvRow[] {
  const records = splitRecords(input).filter((cells) => !isBlank(cells));
  if (records.length === 0) return [];

  const header = records[0].map((name) => name.trim());
  const seen = new Set<string>();
  for (const name of header) {
    if (name === "") throw new CsvError("в шапке есть колонка без имени");
    if (seen.has(name)) throw new CsvError(`колонка «${name}» в шапке дважды`);
    seen.add(name);
  }

  return records.slice(1).map((cells, idx) => {
    const line = idx + 2; // +1 за шапку, +1 за нумерацию с единицы
    if (cells.length !== header.length) {
      throw new CsvError(
        `строка ${line}: колонок ${cells.length}, а в шапке ${header.length}`,
      );
    }
    const row: CsvRow = {};
    header.forEach((name, col) => { row[name] = cells[col].trim(); });
    return row;
  });
}

// Ячейку, где есть разделитель, кавычка или перевод строки, — в кавычки, а
// кавычку удвоить. Остальные — как есть: таблицу правит человек, и лишние
// кавычки вокруг каждого слага только мешали бы ему в диффе.
function quoteCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Запись CSV по RFC 4180 — обратная parseCsv: `parseCsv(stringifyCsv(rows,
 * columns))` даёт те же строки. Колонки — в порядке `columns`; ячейка, которой
 * у строки нет, пишется пустой. Перевод строки — `\n`, в конце файла тоже, как у
 * таблиц в seed_real/. Пишет её `pnpm geo:backfill --csv`.
 */
export function stringifyCsv(rows: CsvRow[], columns: readonly string[]): string {
  const lines = [columns.map(quoteCell).join(",")];
  for (const row of rows) lines.push(columns.map((c) => quoteCell(row[c] ?? "")).join(","));
  return lines.join("\n") + "\n";
}
