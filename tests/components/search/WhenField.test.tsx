import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const url = { pathname: "/kazan", search: "" };
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => url.pathname,
  useSearchParams: () => new URLSearchParams(url.search),
}));

import { content } from "@theme/content";
import { SearchBar } from "@/components/search/SearchBar";
import { _resetSuggestCache } from "@/components/search/suggest-client";
import { _resetPanelDates } from "@/components/search/panel-dates";

const CITIES = [{ slug: "kazan", name: "Казань", geo: null }];
const MAKITA_HREF = `/search?${new URLSearchParams({ q: "дрель makita", city: "kazan" })}`;
const DRILL = {
  queries: [{ text: "дрель makita", href: MAKITA_HREF }],
  categories: [{ name: "Электроинструменты", href: "/kazan/instrumenty/elektro" }],
};
const fetchMock = vi.fn(async (u: string) => {
  const q = new URL(u, "http://x").searchParams.get("q") ?? "";
  return { ok: true, status: 200, json: async () => (q === "дрель" ? DRILL : { queries: [], categories: [] }) };
});

// «Сегодня» в деловой зоне: 12:00 по Москве 1 сентября.
const setToday = (day: string) => vi.setSystemTime(new Date(`${day}T09:00:00Z`));

/** lg — поле «Когда» видно в шапке, список и календарь — поповеры. */
function desktop(on: boolean) {
  if (!on) {
    delete (window as { matchMedia?: unknown }).matchMedia;
    return;
  }
  Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: (q: string) => ({
    matches: q === "(min-width: 1024px)" || q === "(min-width: 768px)",
    addEventListener: () => {},
    removeEventListener: () => {},
  }) });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  setToday("2026-09-01");
  push.mockClear();
  fetchMock.mockClear();
  _resetSuggestCache();
  _resetPanelDates();
  vi.stubGlobal("fetch", fetchMock);
  url.pathname = "/kazan";
  url.search = "";
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  desktop(false);
});

// hidden: открытая и закрывающаяся шторка прячет остальную страницу от
// скринридера (aria-hidden), а vaul в jsdom анимацию закрытия не досматривает.
const when = () => screen.getByRole("button", { name: /^Когда:/, hidden: true });
const forms = () => [...document.querySelectorAll<HTMLFormElement>('form[role="search"]')];
const day = (d: string) => document.querySelector<HTMLButtonElement>(`[data-day="${d}"] button`);
const hidden = (name: string) => document.querySelector<HTMLInputElement>(`input[type="hidden"][name="${name}"]`);

describe("WhenField", () => {
  it("с lg: два клика в любом порядке, поповер закрывается сам, даты уходят с поиском", async () => {
    desktop(true);
    render(<SearchBar variant="header" cities={CITIES} />);
    expect(when()).toHaveAccessibleName(`Когда: ${content.search.when.any}`);

    fireEvent.click(when());
    // Два месяца рядом.
    expect(screen.getAllByRole("grid")).toHaveLength(2);
    expect(screen.getByText(content.search.when.pickFirst)).toBeInTheDocument();

    fireEvent.click(day("2026-09-10")!);
    expect(screen.getByText(content.search.when.pickLast("10 сен"))).toBeInTheDocument();
    fireEvent.click(day("2026-09-05")!);

    await waitFor(() => expect(screen.queryByRole("grid")).not.toBeInTheDocument());
    expect(when()).toHaveAccessibleName("Когда: сб 5 — чт 10 сен · 6 дней");
    expect(hidden("from")).toHaveValue("2026-09-05");
    expect(hidden("to")).toHaveValue("2026-09-10");

    fireEvent.submit(screen.getByRole("search"));
    expect(push).toHaveBeenCalledWith("/kazan?from=2026-09-05&to=2026-09-10");
  });

  // Обе границы включены: один выбранный день — однодневная аренда.
  it("ниже lg: шторка с одним месяцем, один день и «Готово» дают from = to", async () => {
    render(<SearchBar variant="hero" cities={CITIES} citySlug="kazan" />);

    fireEvent.click(when());
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getAllByRole("grid")).toHaveLength(1);

    fireEvent.click(day("2026-09-07")!);
    fireEvent.click(within(sheet).getByRole("button", { name: content.search.when.done }));

    await waitFor(() => expect(when()).toHaveAccessibleName("Когда: пн 7 сен · 1 день"));
    expect(hidden("from")).toHaveValue("2026-09-07");
    expect(hidden("to")).toHaveValue("2026-09-07");
  });

  it("«Любые даты» снимает даты из адреса", () => {
    desktop(true);
    url.search = "from=2026-09-05&to=2026-09-10";
    render(<SearchBar variant="header" cities={CITIES} />);
    expect(when()).toHaveAccessibleName("Когда: сб 5 — чт 10 сен · 6 дней");

    fireEvent.click(when());
    fireEvent.click(screen.getByRole("button", { name: content.search.when.any }));

    expect(when()).toHaveAccessibleName(`Когда: ${content.search.when.any}`);
    expect(hidden("from")).toBeNull();
    fireEvent.submit(screen.getByRole("search"));
    expect(push).toHaveBeenCalledWith("/kazan");
  });

  // Шапка не перерисовывается: «сегодня» берётся при открытии, а не при
  // монтировании, иначе после полуночи открытая вкладка разрешала бы вчера.
  it("считает «сегодня» на клиенте при каждом открытии", () => {
    desktop(true);
    render(<SearchBar variant="header" cities={CITIES} />);

    fireEvent.click(when());
    expect(day("2026-09-01")).not.toBeDisabled();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();

    setToday("2026-09-02");
    fireEvent.click(when());
    expect(day("2026-09-01")).toBeDisabled();
    expect(day("2026-09-02")).not.toBeDisabled();
  });

  it("прошедшие даты из адреса подтягиваются к сегодня, мусорные не показываются", () => {
    desktop(true);
    url.search = "from=2026-08-20&to=2026-09-03";
    const { unmount } = render(<SearchBar variant="header" cities={CITIES} />);
    expect(when()).toHaveAccessibleName("Когда: вт 1 — чт 3 сен · 3 дня");
    unmount();

    url.search = "from=2026-02-30&to=2026-09-03";
    render(<SearchBar variant="header" cities={CITIES} />);
    expect(when()).toHaveAccessibleName(`Когда: ${content.search.when.any}`);
  });

  // После выбора раздела в «Что» фокус переходит на «Когда», как в
  // sravniprokat; переход — кнопкой поиска, с выбранными датами.
  it("с lg выбор раздела в «Что» ведёт фокус в «Когда», а не в раздел", async () => {
    desktop(true);
    url.search = "from=2026-09-05&to=2026-09-10";
    render(<SearchBar variant="header" cities={CITIES} />);

    act(() => screen.getByRole("combobox").focus());
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "дрель" } });
    fireEvent.click(await screen.findByRole("option", { name: "Электроинструменты" }));

    expect(push).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(when());
    // Подсказки — на те же даты: фразы без свободных на них сервер отсеивает.
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("from=2026-09-05&to=2026-09-10"))).toBe(true);

    fireEvent.submit(screen.getByRole("search"));
    expect(push).toHaveBeenCalledWith("/kazan/instrumenty/elektro?from=2026-09-05&to=2026-09-10");
  });

  // Подсказка-запрос — сам поиск: ведёт в выдачу сразу, с выбранными датами.
  it.each([["с lg", true], ["ниже lg", false]])("%s выбор запроса в «Что» ведёт в выдачу с датами", async (_, wide) => {
    desktop(wide);
    url.search = "from=2026-09-05&to=2026-09-10";
    render(<header data-site-header><SearchBar variant="header" cities={CITIES} /></header>);

    act(() => screen.getByRole("combobox").focus());
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "дрель" } });
    fireEvent.click(await screen.findByRole("option", { name: "дрель makita" }));

    expect(push).toHaveBeenCalledWith(`${MAKITA_HREF}&from=2026-09-05&to=2026-09-10`);
  });

  it("правка текста после выбора подсказки — снова свободный поиск", async () => {
    desktop(true);
    render(<SearchBar variant="header" cities={CITIES} />);

    act(() => screen.getByRole("combobox").focus());
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "дрель" } });
    fireEvent.click(await screen.findByRole("option", { name: "Электроинструменты" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "дрель ударная" } });

    fireEvent.submit(screen.getByRole("search"));
    expect(push).toHaveBeenCalledWith(`/search?${new URLSearchParams({ q: "дрель ударная", city: "kazan" })}`);
  });

  // Ниже lg «Когда» в шапке — чип в панели подсказок и точка на иконке поля.
  it("ниже lg: чип в панели подсказок открывает шторку, точка на поле — когда даты выбраны", async () => {
    url.search = "from=2026-09-05&to=2026-09-10";
    render(<header data-site-header><SearchBar variant="header" cities={CITIES} /></header>);
    expect(screen.getByText(content.search.when.datesSet)).toBeInTheDocument();

    act(() => screen.getByRole("combobox").focus());
    const panel = document.querySelector<HTMLElement>("[data-suggest-panel]")!;
    const chip = within(panel).getByRole("button", { name: /^Когда:/ });
    expect(chip).toHaveTextContent("сб 5 — чт 10 сен");

    fireEvent.click(chip);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  // Неотправленный выбор живёт до перехода: вернувшись на тот же адрес
  // («Назад», хлебные крошки), человек видит даты адреса, а не брошенные.
  it("брошенный выбор не возвращается после ухода и возврата на тот же адрес", async () => {
    desktop(true);
    const { rerender } = render(<SearchBar variant="header" cities={CITIES} />);
    fireEvent.click(when());
    fireEvent.click(day("2026-09-05")!);
    fireEvent.click(day("2026-09-10")!);
    await waitFor(() => expect(when()).toHaveAccessibleName("Когда: сб 5 — чт 10 сен · 6 дней"));

    url.pathname = "/kazan/instrumenty";
    rerender(<SearchBar variant="header" cities={CITIES} />);
    expect(when()).toHaveAccessibleName(`Когда: ${content.search.when.any}`);

    url.pathname = "/kazan";
    rerender(<SearchBar variant="header" cities={CITIES} />);
    expect(when()).toHaveAccessibleName(`Когда: ${content.search.when.any}`);
    expect(hidden("from")).toBeNull();
  });

  // На телефоне человек выбирает даты в hero, а подсказку берёт в панели
  // шапки (поле hero отдаёт ей фокус) — шапка отправляет те же даты.
  it("даты, выбранные в hero, видит и отправляет шапка", async () => {
    render(
      <>
        <header data-site-header><SearchBar variant="header" cities={CITIES} /></header>
        <SearchBar variant="hero" cities={CITIES} citySlug="kazan" />
      </>,
    );
    const heroWhen = screen.getAllByRole("button", { name: /^Когда:/, hidden: true }).at(-1)!;
    fireEvent.click(heroWhen);
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(day("2026-09-05")!);
    fireEvent.click(day("2026-09-06")!);
    fireEvent.click(within(sheet).getByRole("button", { name: content.search.when.done }));

    const [headerForm] = forms();
    await waitFor(() =>
      expect(headerForm!.querySelector('input[type="hidden"][name="from"]')).toHaveValue("2026-09-05"));
    fireEvent.submit(headerForm!);
    expect(push).toHaveBeenCalledWith("/kazan?from=2026-09-05&to=2026-09-06");
  });
});
