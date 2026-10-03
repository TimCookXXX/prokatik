import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { CsvError, parseCsv, stringifyCsv } from "@/lib/csv";

describe("parseCsv", () => {
  it("разбирает шапку и строки", () => {
    expect(parseCsv("a,b\n1,2\n")).toEqual([{ a: "1", b: "2" }]);
  });

  it("запятая внутри кавычек не делит поле", () => {
    const rows = parseCsv('title,note\nДрель,"Берите очки, перчаток нет"\n');
    expect(rows[0].note).toBe("Берите очки, перчаток нет");
  });

  // Единственный случай RFC 4180, который портит данные молча: без обработки
  // `""` описание обрежется по середине и уедет в базу без ошибки.
  it("удвоенная кавычка внутри поля — одна кавычка", () => {
    const rows = parseCsv('title,note\nСапборд,"Доска 10""10, надувная"\n');
    expect(rows[0].note).toBe('Доска 10"10, надувная');
  });

  it("перевод строки внутри кавычек остаётся в поле", () => {
    const rows = parseCsv('a,b\n1,"первая\nвторая"\n');
    expect(rows[0].b).toBe("первая\nвторая");
    expect(rows).toHaveLength(1);
  });

  it("снимает BOM с имени первой колонки", () => {
    const rows = parseCsv("﻿slug,name\nkrasnodar,Краснодар\n");
    expect(rows[0].slug).toBe("krasnodar");
  });

  it("понимает CRLF", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([{ a: "1", b: "2" }]);
  });

  it("последняя строка без перевода строки — тоже запись", () => {
    expect(parseCsv("a,b\n1,2")).toHaveLength(1);
  });

  it("пустые строки пропускаются", () => {
    expect(parseCsv("a,b\n1,2\n\n3,4\n")).toHaveLength(2);
  });

  // Экспорт из редактора таблиц часто дописывает в конец строки из одних
  // запятых. По числу колонок они валидны, и без этой проверки человек получил
  // бы «title пустой» вместо «удалите пустую строку».
  it("строка из одних запятых — тоже пустая", () => {
    expect(parseCsv("a,b,c\n1,2,3\n,,\n")).toHaveLength(1);
  });

  it("пустое поле — пустая строка, а не undefined", () => {
    expect(parseCsv("a,b\n1,\n")[0].b).toBe("");
  });

  it("обрезает пробелы по краям ячейки", () => {
    expect(parseCsv("a,b\n  1  ,  два  \n")[0]).toEqual({ a: "1", b: "два" });
  });

  // Сдвиг колонок после ручной правки в Numbers иначе прошёл бы как валидные
  // данные: описание молча встало бы в адрес.
  it("расхождение числа колонок с шапкой — ошибка с номером строки", () => {
    expect(() => parseCsv("a,b,c\n1,2,3\n4,5\n")).toThrow(CsvError);
    expect(() => parseCsv("a,b,c\n1,2,3\n4,5\n")).toThrow(/строка 3/);
  });

  it("незакрытая кавычка — ошибка", () => {
    expect(() => parseCsv('a,b\n1,"хвост\n')).toThrow(CsvError);
  });

  it("повтор колонки в шапке — ошибка", () => {
    expect(() => parseCsv("a,a\n1,2\n")).toThrow(/дважды/);
  });

  it("колонка без имени в шапке — ошибка", () => {
    expect(() => parseCsv("a,,c\n1,2,3\n")).toThrow(/без имени/);
  });

  it("файл без строк данных — пустой список", () => {
    expect(parseCsv("a,b\n")).toEqual([]);
    expect(parseCsv("")).toEqual([]);
  });
});

describe("stringifyCsv", () => {
  it("кавычит только ячейки с запятой, кавычкой или переводом строки", () => {
    const out = stringifyCsv(
      [{ a: "дрель", b: 'Доска 10"10, надувная', c: "первая\nвторая" }],
      ["a", "b", "c"],
    );
    expect(out).toBe('a,b,c\nдрель,"Доска 10""10, надувная","первая\nвторая"\n');
  });

  it("пишет колонки в заданном порядке, отсутствующие — пустыми", () => {
    expect(stringifyCsv([{ b: "2", a: "1" }], ["a", "c", "b"])).toBe("a,c,b\n1,,2\n");
  });

  // Её пишет geo:backfill поверх таблицы, которую правит человек: описания там
  // многострочные, с запятыми и кавычками. Сдвиг хотя бы одной ячейки
  // перепутал бы описание с адресом.
  it("кругооборот на реальном seed_real/listings.csv даёт те же строки", () => {
    const text = readFileSync("seed_real/listings.csv", "utf8");
    const rows = parseCsv(text);
    const columns = Object.keys(rows[0]);
    expect(rows.length).toBeGreaterThan(0);
    expect(parseCsv(stringifyCsv(rows, columns))).toEqual(rows);
  });
});
