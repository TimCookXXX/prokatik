import { readFileSync } from "node:fs";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/kazan",
  useSearchParams: () => new URLSearchParams(""),
}));

import { content } from "@theme/content";
import { SearchBar } from "@/components/search/SearchBar";
import { _resetSuggestCache } from "@/components/search/suggest-client";

const CITIES = [{ slug: "kazan", name: "Казань", geo: null }];

const hrefOf = (q: string) => `/search?${new URLSearchParams({ q, city: "kazan" })}`;
const ELECTRO = { name: "Электроинструменты", href: "/kazan/instrumenty/elektro" };
// «дре» — дописанные запросы и раздел; набранного запроса среди них нет.
const DRE = {
  queries: [{ text: "дрель", href: hrefOf("дрель") }, { text: "дрель-миксер", href: hrefOf("дрель-миксер") }],
  categories: [ELECTRO],
};
// «дрель» — среди подсказок ровно набранный запрос.
const DRILL = {
  queries: [{ text: "дрель", href: hrefOf("дрель") }, { text: "дрель makita", href: hrefOf("дрель makita") }],
  categories: [ELECTRO],
};

type Reply = { status: number; body?: unknown } | Error;

// Ответы сервера по запросу. Задержанные (gate) отвечают по команде теста —
// чтобы проверить порядок ответов.
let replies: Record<string, Reply> = {};
const gates = new Map<string, { promise: Promise<Reply>; open: (r: Reply) => void }>();
function gate(q: string) {
  let open!: (r: Reply) => void;
  const promise = new Promise<Reply>((resolve) => { open = resolve; });
  gates.set(q, { promise, open });
}
const fetchMock = vi.fn(async (url: string) => {
  const q = new URL(url, "http://x").searchParams.get("q") ?? "";
  const reply = gates.has(q)
    ? await gates.get(q)!.promise
    : replies[q] ?? { status: 200, body: { queries: [], categories: [] } };
  if (reply instanceof Error) throw reply;
  return { ok: reply.status < 400, status: reply.status, json: async () => reply.body };
});

beforeEach(() => {
  _resetSuggestCache();
  push.mockClear();
  fetchMock.mockClear();
  replies = { "дре": { status: 200, body: DRE }, "дрель": { status: 200, body: DRILL } };
  gates.clear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

const field = () => screen.getByRole("combobox");
const type = (text: string) => fireEvent.change(field(), { target: { value: text } });
const options = () => screen.queryAllByRole("option");

function renderBar() {
  render(<SearchBar variant="header" cities={CITIES} />);
}

describe("WhatField", () => {
  it("shows nothing and asks nothing for an empty field", async () => {
    renderBar();
    expect(field()).not.toHaveAttribute("aria-controls");
    act(() => field().focus());
    // Дебаунс прошёл бы — запроса всё равно нет.
    await act(async () => { await new Promise((r) => setTimeout(r, 150)); });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(field()).toHaveAttribute("aria-expanded", "false");
    expect(field()).not.toHaveAttribute("aria-controls");
    expect(screen.queryByText(/Популярн/)).not.toBeInTheDocument();
  });

  it("lists completed queries, then sections, then «show all», and announces the count", async () => {
    renderBar();
    act(() => field().focus());
    type("дре");

    await screen.findByRole("option", { name: "дрель-миксер" });
    expect(options().map((o) => o.textContent)).toEqual([
      "дрель", "дрель-миксер", "Электроинструменты", content.search.showAll("дре"),
    ]);
    // Запросы — без видимого заголовка, разделы — с ним.
    expect(screen.getByRole("group", { name: content.search.queries })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: content.search.categories })).toHaveTextContent(content.search.categories);
    expect(screen.getByRole("listbox")).not.toHaveTextContent(content.search.queries);
    // Совпавшее начало слова выделено.
    expect(screen.getAllByText("дре", { selector: "b" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("status")).toHaveTextContent("3 подсказки");
  });

  it("has no listings, prices or counts in the rows, and one accessible name per row", async () => {
    renderBar();
    act(() => field().focus());
    type("дрель");
    await screen.findByRole("option", { name: "дрель makita" });

    for (const o of options()) expect(o.textContent).not.toMatch(/\d|₽|объявлен/);
    expect(screen.getByRole("option", { name: "Электроинструменты" })).toBeInTheDocument();
    expect(document.querySelector('[role="option"] img')).toBeNull();
  });

  it("drops «show all» when a suggestion is exactly the typed query", async () => {
    renderBar();
    act(() => field().focus());
    type("Дрель");
    await screen.findByRole("option", { name: "дрель makita" });
    expect(screen.queryByRole("option", { name: content.search.showAll("Дрель") })).not.toBeInTheDocument();
    expect(options()).toHaveLength(3);
  });

  it("sends a trailing space: after it the server offers the typed query", async () => {
    renderBar();
    act(() => field().focus());
    type("дрель ");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/search/suggest?city=kazan&q=%D0%B4%D1%80%D0%B5%D0%BB%D1%8C+"));
  });

  it("moves the active row with arrows and marks it for the stylesheet", async () => {
    renderBar();
    act(() => field().focus());
    type("дре");
    await screen.findByRole("option", { name: "дрель-миксер" });

    fireEvent.keyDown(field(), { key: "ArrowDown" });
    const first = options()[0];
    expect(first).toHaveAttribute("data-active", "true");
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(field()).toHaveAttribute("aria-activedescendant", first.id);

    // Вверх с первой строки — на последнюю, «Показать все».
    fireEvent.keyDown(field(), { key: "ArrowUp" });
    expect(options().at(-1)).toHaveAttribute("data-active", "true");
    expect(first).toHaveAttribute("data-active", "false");
  });

  it("paints the keyboard cursor with the hover overlay token", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toMatch(/\[role="option"\]\[data-active="true"\]\s*\{[^}]*var\(--color-hover\)/);
  });

  it("Enter on a query opens /search with it", async () => {
    renderBar();
    act(() => field().focus());
    type("дрель");
    await screen.findByRole("option", { name: "дрель makita" });

    fireEvent.keyDown(field(), { key: "ArrowDown" });
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    fireEvent.keyDown(field(), { key: "Enter" });

    expect(push).toHaveBeenCalledWith(hrefOf("дрель makita"));
    // Шапка показывает то, что будет в адресе, — сам запрос.
    expect(field()).toHaveValue("дрель makita");
  });

  it("a click on a section opens the section", async () => {
    renderBar();
    act(() => field().focus());
    type("дрель");
    fireEvent.click(await screen.findByRole("option", { name: "Электроинструменты" }));
    expect(push).toHaveBeenCalledWith("/kazan/instrumenty/elektro");
  });

  it("Enter without an active row searches the free text", async () => {
    renderBar();
    act(() => field().focus());
    type("дрель");
    await screen.findByRole("option", { name: "дрель makita" });

    fireEvent.submit(screen.getByRole("search"));
    expect(push).toHaveBeenCalledWith("/search?q=%D0%B4%D1%80%D0%B5%D0%BB%D1%8C&city=kazan");
  });

  it("Escape closes the list and keeps the focus", async () => {
    renderBar();
    act(() => field().focus());
    type("дрель");
    await screen.findByRole("listbox");

    fireEvent.keyDown(field(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(field()).toHaveAttribute("aria-expanded", "false");
    expect(field()).not.toHaveAttribute("aria-controls");
    expect(document.activeElement).toBe(field());
  });

  it("says there are no exact suggestions and still offers «show all»", async () => {
    renderBar();
    act(() => field().focus());
    type("абвгд");

    expect(await screen.findByText(content.search.noMatches("абвгд"))).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(content.search.noSuggest);
    fireEvent.click(screen.getByRole("option", { name: content.search.showAll("абвгд") }));
    expect(push).toHaveBeenCalledWith("/search?q=%D0%B0%D0%B1%D0%B2%D0%B3%D0%B4&city=kazan");
  });

  it.each([
    ["a network error", new Error("offline")],
    ["the rate limit", { status: 429, body: { queries: [], categories: [] } }],
  ])("treats %s as «no suggestions»", async (_, reply) => {
    replies["дрель"] = reply as Reply;
    renderBar();
    act(() => field().focus());
    type("дрель");

    expect(await screen.findByText(content.search.noMatches("дрель"))).toBeInTheDocument();
    expect(screen.getByRole("option", { name: content.search.showAll("дрель") })).toBeInTheDocument();
  });

  it("an older reply never replaces a newer one", async () => {
    gate("дре");
    renderBar();
    act(() => field().focus());
    type("дре");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/search/suggest?city=kazan&q=%D0%B4%D1%80%D0%B5"));

    type("дрель");
    await screen.findByRole("option", { name: "дрель makita" });

    // Ответ на «дре» пришёл последним — список не откатывается.
    await act(async () => {
      gates.get("дре")!.open({ status: 200, body: { queries: [], categories: [] } });
    });
    expect(screen.getByRole("option", { name: "дрель makita" })).toBeInTheDocument();
    expect(screen.queryByText(content.search.noMatches("дрель"))).not.toBeInTheDocument();
  });

  // Браузер мог закэшировать ответ прежней формы (`items`) — он не роняет поле.
  it("reads an old-shaped body as sections only", async () => {
    replies["дрель"] = { status: 200, body: { items: [{ id: "l1", title: "Дрель" }], categories: [ELECTRO] } };
    renderBar();
    act(() => field().focus());
    type("дрель");

    await screen.findByRole("option", { name: "Электроинструменты" });
    expect(options().map((o) => o.textContent)).toEqual(["Электроинструменты", content.search.showAll("дрель")]);
  });

  it("keeps the field focused and opens the full-screen panel on phones", async () => {
    renderBar();
    act(() => field().focus());

    const panel = document.querySelector("[data-suggest-panel]");
    expect(panel).not.toBeNull();
    expect(panel).toHaveClass("z-50");
    expect(document.activeElement).toBe(field());
    // Пустое поле — в панели только верхняя строка, без списка.
    expect(within(panel as HTMLElement).queryByRole("listbox")).toBeNull();

    fireEvent.click(within(panel as HTMLElement).getByRole("button", { name: content.search.closeSuggest }));
    expect(document.querySelector("[data-suggest-panel]")).toBeNull();
  });

  // Ниже lg hero отдаёт фокус полю шапки — но только касанием или кликом. С
  // клавиатуры фокус остаётся в hero, иначе Tab ходил бы по кругу шапка → hero.
  describe("hero below lg", () => {
    function renderHeaderAndHero() {
      render(
        <>
          <header data-site-header><SearchBar variant="header" cities={CITIES} /></header>
          <SearchBar variant="hero" cities={CITIES} citySlug="kazan" />
        </>,
      );
      const [header, hero] = screen.getAllByRole("combobox");
      return { header, hero };
    }

    it("hands a tap over to the header field", () => {
      const { header, hero } = renderHeaderAndHero();
      fireEvent.pointerDown(hero);
      act(() => hero.focus());
      expect(document.activeElement).toBe(header);
    });

    it("keeps keyboard focus in the hero, without a panel of its own", () => {
      const { hero } = renderHeaderAndHero();
      act(() => hero.focus());
      expect(document.activeElement).toBe(hero);
      expect(document.querySelector("[data-suggest-panel]")).toBeNull();

      fireEvent.change(hero, { target: { value: "дрель" } });
      expect(document.querySelector("[data-suggest-panel]")).toBeNull();
    });
  });

  it("uses a popover under the field from lg", async () => {
    Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: (q: string) => ({
      matches: q === "(min-width: 1024px)",
      addEventListener: () => {},
      removeEventListener: () => {},
    }) });
    renderBar();
    act(() => field().focus());
    type("дрель");

    await screen.findByRole("option", { name: "дрель makita" });
    expect(document.querySelector("[data-suggest-panel]")).toBeNull();
    // Поповер — в портале, вне формы: секция hero с overflow-hidden его не обрежет.
    expect(screen.getByRole("search")).not.toContainElement(screen.getByRole("listbox"));

    // Запрос с lg ведёт в выдачу сразу — это сам поиск, а не выбор вещи.
    fireEvent.click(screen.getByRole("option", { name: "дрель makita" }));
    expect(push).toHaveBeenCalledWith(hrefOf("дрель makita"));
  });
});
