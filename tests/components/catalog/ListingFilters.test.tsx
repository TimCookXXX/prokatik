import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ListingFilters } from "@/components/catalog/ListingFilters";
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
});
