import { fireEvent, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { FilterForm, ListingFilters } from "@/components/catalog/ListingFilters";
import { carryParams } from "@/lib/catalog/filters";

const radio = (value: string) =>
  document.querySelector<HTMLInputElement>(`input[name="deposit"][value="${value}"]`)!;
const handover = (value: string) =>
  document.querySelector<HTMLInputElement>(`input[name="handover"][value="${value}"]`)!;
const verified = () =>
  document.querySelector<HTMLInputElement>('input[name="verified"]')!;

describe("ListingFilters", () => {
  it("показывает применённые фильтры", () => {
    render(<ListingFilters basePath="/kazan/tools" state={{ deposit: "money", verifiedOnly: true }} />);
    expect(radio("money").checked).toBe(true);
    expect(radio("none").checked).toBe(false);
    expect(verified().checked).toBe(true);
  });

  // Регрессия: «Сбросить» — клиентский переход, React переиспользует ту же
  // форму, а поля здесь неуправляемые (defaultChecked) и читают состояние
  // только при монтировании. Без ключа по фильтрам чипы и тумблер оставались
  // нажатыми после сброса, хотя адрес уже был чистый.
  it("сбрасывает чипы и тумблер, когда фильтры ушли из адреса", () => {
    const { rerender } = render(
      <ListingFilters basePath="/kazan/tools" state={{ deposit: "money", verifiedOnly: true }} />,
    );
    rerender(<ListingFilters basePath="/kazan/tools" state={{}} />);

    expect(radio("money").checked).toBe(false);
    expect(verified().checked).toBe(false);
  });

  // Форма фильтров — GET, и в адрес попадает ровно то, что она отправила.
  // Вид, даты и сортировка живут в верхней панели, полей у формы не имеют, и
  // без скрытых копий сабмит «Показать» возвращал список в сетку и терял
  // выбранный диапазон дат.
  //
  // Даты приходят из carryParams, как их собирают выдачи: нормализованными —
  // форма отправляет те же даты, что применены, а не сырой query.
  it("переносит состояние верхней панели скрытыми полями", () => {
    const carry = carryParams({ from: "2026-08-25", to: "2026-09-04" }, { today: "2026-08-29" });
    render(
      <ListingFilters
        basePath="/kazan/tools"
        state={{ deposit: "money" }}
        hidden={{ ...Object.fromEntries(carry), view: "list", sort: "price_asc" }}
      />,
    );
    const hiddenField = (name: string) =>
      document.querySelector<HTMLInputElement>(`input[type="hidden"][name="${name}"]`);

    expect(hiddenField("view")).toHaveValue("list");
    expect(hiddenField("from")).toHaveValue("2026-08-29");
    expect(hiddenField("to")).toHaveValue("2026-09-04");
    expect(hiddenField("sort")).toHaveValue("price_asc");
  });

  // «Где» — тоже состояние верхней панели: без скрытых копий «Показать» в
  // фильтрах цены терял бы точку, а с ней расстояния и «Ближе».
  it("переносит точку «Где» и «Ближе»", () => {
    const carry = carryParams({ loc: "p:44.98812,38.94811", la: "Яблоновский", lp: "t", src: "x" });
    render(
      <ListingFilters
        basePath="/krasnodar/tools"
        state={{}}
        hidden={{ ...Object.fromEntries(carry), sort: "near" }}
      />,
    );
    const hiddenField = (name: string) =>
      document.querySelector<HTMLInputElement>(`input[type="hidden"][name="${name}"]`);

    // Точка — кодеком: три знака, мусор в src отброшен.
    expect(hiddenField("loc")).toHaveValue("p:44.988,38.948");
    expect(hiddenField("la")).toHaveValue("Яблоновский");
    expect(hiddenField("lp")).toHaveValue("t");
    expect(hiddenField("src")).toBeNull();
    expect(hiddenField("sort")).toHaveValue("near");
  });

  // Пустые значения полями не становятся: иначе адрес обрастал бы `view=&from=`.
  // Половинчатые даты carryParams не переносит вовсе.
  it("не создаёт полей для незаданных параметров", () => {
    const carry = carryParams({ from: "2026-09-01" }, { today: "2026-08-29" });
    render(<ListingFilters basePath="/kazan/tools" state={{}} hidden={{ ...Object.fromEntries(carry), view: "" }} />);
    expect(document.querySelectorAll('input[type="hidden"]')).toHaveLength(0);
  });

  // «Как забрать» долго стоял в разметке отключённым: поля в listings не было,
  // и блок намеренно ничего не отбирал. Тест держит его рабочим.
  it("способ получения выбирается и отражает адрес", () => {
    render(<ListingFilters basePath="/kazan/tools" state={{ handover: "delivery" }} />);

    expect(handover("delivery").checked).toBe(true);
    expect(handover("pickup").checked).toBe(false);
  });

  // Единственный фильтр в адресе: иначе ключ формы менял бы соседний фильтр, и
  // тест проходил бы, даже забудь мы handover в stateKey.
  it("сбрасывает способ получения, когда он ушёл из адреса", () => {
    const { rerender } = render(
      <ListingFilters basePath="/kazan/tools" state={{ handover: "pickup" }} />,
    );
    rerender(<ListingFilters basePath="/kazan/tools" state={{}} />);

    expect(handover("pickup").checked).toBe(false);
  });

  it("переключение одного фильтра не сбрасывает соседний", () => {
    const { rerender } = render(
      <ListingFilters basePath="/kazan/tools" state={{ deposit: "money", verifiedOnly: true }} />,
    );
    rerender(<ListingFilters basePath="/kazan/tools" state={{ deposit: "none", verifiedOnly: true }} />);

    expect(radio("none").checked).toBe(true);
    expect(radio("money").checked).toBe(false);
    expect(verified().checked).toBe(true);
  });

  // Регрессия: слайдер всегда отправлял обе границы, по умолчанию — края
  // раздела. «Без залога» + «Показать» давали ?price_min=..&price_max=..,
  // и чип «Фильтры» показывал 2 вместо 1.
  describe("цена в отправке формы", () => {
    const bounds = { min: 100, max: 900 };
    const sent = () => {
      const form = document.querySelector("form")!;
      return [...new FormData(form).keys()];
    };

    it("ручки на краях раздела — цены в адресе нет", () => {
      render(<FilterForm basePath="/kazan/tools" state={{}} priceBounds={bounds} />);
      fireEvent.click(radio("none"));
      expect(sent()).toContain("deposit");
      expect(sent()).not.toContain("price_min");
      expect(sent()).not.toContain("price_max");
    });

    it("отправляет только сдвинутую границу", () => {
      render(<FilterForm basePath="/kazan/tools" state={{}} priceBounds={bounds} />);
      fireEvent.change(document.querySelector('input[type="number"][id$="-min"]')!, {
        target: { value: "300" },
      });
      const data = new FormData(document.querySelector("form")!);
      expect(data.get("price_min")).toBe("300");
      expect(data.has("price_max")).toBe(false);
    });

    it("ручка, вернувшаяся на край, снимает границу из адреса", () => {
      render(<FilterForm basePath="/kazan/tools" state={{ priceMax: 500 }} priceBounds={bounds} />);
      expect(sent()).toContain("price_max");
      fireEvent.change(document.querySelector('input[type="number"][id$="-max"]')!, {
        target: { value: "900" },
      });
      expect(sent()).not.toContain("price_max");
    });

    // Без JS гидрации не будет: серверная разметка — единственный ввод цены,
    // и поля обязаны оставаться именованными, иначе цену не отправить вовсе.
    it("в серверной разметке поля цены именованные", () => {
      const html = renderToString(<FilterForm basePath="/kazan/tools" state={{}} priceBounds={bounds} />);
      expect(html).toContain('name="price_min"');
      expect(html).toContain('name="price_max"');
    });
  });
});
