// «Где» в панели поиска (перенос тестов WhereField из sravniprokat без
// справочника микрорайонов и округов): улицы из мини-индекса, дома с сервера,
// «≈», Enter, геолокация с подписью без дома и точностью, «Недавнее» как
// строка, город целиком — без точки. Сеть подменена: мини-индекс, подсказки и
// обратный геокодер считает тот же движок по фикстуре. Воркера в jsdom нет —
// мини-индекс собирается в главном потоке (address-client.ts).
import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const url = { pathname: "/krasnodar", search: "" };
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => url.pathname,
  useSearchParams: () => new URLSearchParams(url.search),
}));

import { content } from "@theme/content";
import { buildClientIndex, createGeocoder } from "@/lib/geocoder";
import { locationQuery, type UserPoint } from "@/lib/geo/location";
import { WhereField } from "@/components/search/WhereField";
import { HeaderSearch } from "@/components/layout/HeaderSearch";
import { _resetPanelDates } from "@/components/search/panel-dates";
import { _resetSuggestCache } from "@/components/search/suggest-client";
import { FIXTURE } from "../../geocoder/fixture";

const engine = createGeocoder(structuredClone(FIXTURE));
const clientIndex = JSON.stringify(buildClientIndex(structuredClone(FIXTURE)));
const CENTRE = { lat: 45.0355, lon: 38.9753 };
const t = content.search.where;

let token = 0;
const calls: URL[] = [];

beforeEach(() => {
  calls.length = 0;
  push.mockClear();
  _resetPanelDates();
  _resetSuggestCache();
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const u = new URL(input, "http://localhost");
    calls.push(u);
    if (u.pathname === "/api/geo/client-index") return new Response(clientIndex, { status: 200 });
    if (u.pathname === "/api/geo/suggest") {
      const [lat, lon] = (u.searchParams.get("near") ?? "").split(",").map(Number);
      return Response.json({ items: engine.suggest(u.searchParams.get("q") ?? "", { near: { lat, lon }, limit: 7 }) });
    }
    if (u.pathname === "/api/geo/reverse") {
      return Response.json({ hit: engine.reverse(Number(u.searchParams.get("lat")), Number(u.searchParams.get("lon"))) });
    }
    if (u.pathname === "/api/search/suggest") return Response.json({ items: [], categories: [] });
    return new Response("{}", { status: 404 });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  // jsdom геолокации не знает; тесты ставят её себе сами.
  delete (navigator as { geolocation?: unknown }).geolocation;
});

const geoCity = (region = "krasnodar") => ({
  slug: "krasnodar", name: "Краснодар", geo: { region, centre: CENTRE, token: `t${++token}` },
});

function Harness({
  initial = null, onChange = () => {}, region,
}: {
  initial?: UserPoint | null;
  onChange?: (p: UserPoint | null) => void;
  region?: string;
}) {
  const [value, setValue] = useState<UserPoint | null>(initial);
  // Метка своя на каждый рендер: мини-индекс кэшируется на вкладку по метке.
  const [city] = useState(() => geoCity(region));
  return (
    <WhereField variant="header" city={city} value={value} onChange={(p) => { onChange(p); setValue(p); }} />
  );
}

const input = () => screen.getByRole("combobox");
const options = () => screen.queryAllByRole("option");
const type = (text: string) => fireEvent.change(input(), { target: { value: text } });
const serverCalls = () => calls.filter((u) => u.pathname === "/api/geo/suggest");

async function focusReady() {
  fireEvent.focus(input());
  await waitFor(() => expect(calls.some((u) => u.pathname === "/api/geo/client-index")).toBe(true));
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}

function allowGeolocation(coords: { latitude: number; longitude: number; accuracy?: number } | null) {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: (ok: PositionCallback, fail: PositionErrorCallback) => (coords
        ? ok({ coords } as GeolocationPosition)
        : fail({ code: 1, message: "denied" } as GeolocationPositionError)),
    },
  });
}

describe("WhereField", () => {
  it("streets come from the mini index without a server request", async () => {
    render(<Harness />);
    await focusReady();
    type("чукотск");
    await waitFor(() => expect(screen.getByText("улица Чукотская")).toBeInTheDocument());
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
    expect(serverCalls()).toHaveLength(0);
  });

  it("a house from the server carries its point: one click, an exact point", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await focusReady();
    type("красная 120");
    await waitFor(() => expect(options()[0]).toHaveTextContent("улица Красная, 120"));
    fireEvent.click(options()[0]);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      label: "улица Красная, 120, Краснодар", source: "address", precision: "house",
    }));
    expect(locationQuery(onChange.mock.lastCall![0]).lp).toBeUndefined();
    expect(input()).toHaveValue("улица Красная, 120, Краснодар");
  });

  it("a street is marked «≈» in the list and gives an approximate point (lp=s)", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await focusReady();
    type("ставропольская 106");
    await waitFor(() => expect(options()[0]).toHaveTextContent("улица Ставропольская, ≈106"));
    expect(options()[0]).toHaveTextContent("≈ до улицы");
    fireEvent.click(options()[0]);
    const p = onChange.mock.lastCall![0] as UserPoint;
    expect(p.precision).toBe("street");
    expect(locationQuery(p).lp).toBe("s");
  });

  it("a settlement gives an approximate point (lp=t)", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await focusReady();
    type("юбилейн");
    await waitFor(() => expect(options()[0]).toHaveTextContent("Юбилейный"));
    fireEvent.click(options()[0]);
    expect(locationQuery(onChange.mock.lastCall![0]).lp).toBe("t");
  });

  // Город и округ — площади в десятки км: «≈ 4 км» до их центра было бы ложным
  // числом среди настоящих. Выбор означает «весь город».
  it("the whole city gives no point", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await focusReady();
    type("краснодар");
    await waitFor(() => expect(options().some((o) => o.textContent?.startsWith("Краснодар"))).toBe(true));
    fireEvent.click(options().find((o) => o.textContent?.startsWith("Краснодар"))!);
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(input()).toHaveValue("");
  });

  it("Enter on typed text takes the first address", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await focusReady();
    type("базовская 21к1");
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.lastCall![0]).toMatchObject({ label: "улица Базовская, 21к1, Яблоновский", precision: "house" });
  });

  describe("my location", () => {
    const h = FIXTURE.houses.find((x) => x.number === "120")!;

    it("labels the point by the reverse geocoder, without the house number", async () => {
      allowGeolocation({ latitude: h.lat, longitude: h.lon, accuracy: 20 });
      const onChange = vi.fn();
      render(<Harness onChange={onChange} />);
      fireEvent.focus(input());
      fireEvent.click(await screen.findByText(t.myLocation));
      await waitFor(() => expect(onChange).toHaveBeenCalled());
      const p = onChange.mock.lastCall![0] as UserPoint;
      expect(p).toMatchObject({ source: "geo", label: "улица Красная, Краснодар", precision: "house", point: { lat: h.lat, lon: h.lon } });
      expect(locationQuery(p)).toMatchObject({ src: "geo", la: "улица Красная, Краснодар" });
      expect(locationQuery(p).la).not.toMatch(/\d/);
    });

    // Десктоп по Wi-Fi или IP промахивается на сотни метров: «350 м» до вещи
    // было бы ложной точностью.
    it("a rough fix (accuracy > 150 m) gives approximate distances (lp=s)", async () => {
      allowGeolocation({ latitude: h.lat, longitude: h.lon, accuracy: 900 });
      const onChange = vi.fn();
      render(<Harness onChange={onChange} />);
      fireEvent.focus(input());
      fireEvent.click(await screen.findByText(t.myLocation));
      await waitFor(() => expect(onChange).toHaveBeenCalled());
      expect(locationQuery(onChange.mock.lastCall![0]).lp).toBe("s");
    });

    it("a refusal changes nothing and shows no error", async () => {
      allowGeolocation(null);
      const onChange = vi.fn();
      render(<Harness onChange={onChange} />);
      fireEvent.focus(input());
      fireEvent.click(await screen.findByText(t.myLocation));
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      expect(onChange).not.toHaveBeenCalled();
      expect(screen.queryByText(content.address.failed)).toBeNull();
      expect(calls.some((u) => u.pathname === "/api/geo/reverse")).toBe(false);
    });

    // Разрешение и сеть идут до десятка секунд: место, выбранное за это время,
    // поздний ответ геолокации не затирает — ни в поле, ни в «Недавнем».
    it("a late fix does not overwrite a place picked while it was pending", async () => {
      let resolve: ((pos: GeolocationPosition) => void) | null = null;
      Object.defineProperty(navigator, "geolocation", {
        configurable: true,
        value: { getCurrentPosition: (ok: PositionCallback) => { resolve = ok; } },
      });
      const onChange = vi.fn();
      render(<Harness onChange={onChange} />);
      await focusReady();
      fireEvent.click(await screen.findByText(t.myLocation));
      await waitFor(() => expect(resolve).not.toBeNull());
      fireEvent.focus(input());
      type("юбилейн");
      await waitFor(() => expect(options()[0]).toHaveTextContent("Юбилейный"));
      fireEvent.click(options()[0]);
      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ source: "address" }));

      await act(async () => {
        resolve!({ coords: { latitude: h.lat, longitude: h.lon, accuracy: 20 } } as GeolocationPosition);
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(input()).toHaveValue("Юбилейный, Краснодар");
      expect(JSON.parse(localStorage.getItem("inrenta_loc")!)).not.toHaveProperty("src");
      expect(input()).not.toHaveAttribute("placeholder", t.locating);
    });

    it("is not offered without geolocation in the browser", async () => {
      render(<Harness />);
      fireEvent.focus(input());
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
      expect(screen.queryByText(t.myLocation)).toBeNull();
    });
  });

  describe("the last place from this device", () => {
    const yab: UserPoint = {
      point: { lat: 44.988, lon: 38.948 }, label: "улица Базовская, Яблоновский", source: "address", precision: "street",
    };
    const remember = (region: string, p: UserPoint) =>
      localStorage.setItem("inrenta_loc", JSON.stringify({ region, ...locationQuery(p) }));

    // Применённым значением оно не становится: шапка писала бы «Где: улица …»
    // над карточками без расстояний.
    it("is a row of the list, not the value of the field", async () => {
      remember("krasnodar", yab);
      const onChange = vi.fn();
      render(<Harness onChange={onChange} />);
      expect(input()).toHaveValue("");
      fireEvent.focus(input());
      const row = await screen.findByText(t.recent(yab.label!));
      expect(onChange).not.toHaveBeenCalled();
      fireEvent.click(row);
      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ label: yab.label, precision: "street" }));
    });

    it("hides while typing and serves as the near point, also for the server", async () => {
      remember("krasnodar", yab);
      render(<Harness />);
      await focusReady();
      type("базовская 2");
      await waitFor(() => expect(serverCalls().length).toBeGreaterThan(0));
      expect(serverCalls()[0].searchParams.get("near")).toBe("44.9880,38.9480");
      expect(screen.queryByText(t.recent(yab.label!))).toBeNull();
    });

    it("is ignored in a city of another region", async () => {
      remember("moscow", yab);
      render(<Harness />);
      fireEvent.focus(input());
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
      expect(screen.queryByText(t.recent(yab.label!))).toBeNull();
    });

    it("a pick is remembered with the region; «×» forgets it", async () => {
      render(<Harness />);
      await focusReady();
      type("ставропольск");
      await waitFor(() => expect(options()[0]).toHaveTextContent("улица Ставропольская"));
      fireEvent.click(options()[0]);
      expect(JSON.parse(localStorage.getItem("inrenta_loc")!)).toMatchObject({ region: "krasnodar", la: "улица Ставропольская, Краснодар", lp: "s" });
      fireEvent.click(screen.getByRole("button", { name: content.address.clear }));
      expect(localStorage.getItem("inrenta_loc")).toBeNull();
      expect(input()).toHaveValue("");
    });
  });

  it("shows the label of a point from the address, and a point without one by its source", () => {
    const { unmount } = render(<Harness initial={{ point: CENTRE, label: null, source: "geo", precision: "house" }} />);
    expect(input()).toHaveValue(t.myLocation);
    unmount();
    render(<Harness initial={{ point: CENTRE, label: null, source: "address", precision: "house" }} />);
    expect(input()).toHaveValue(t.point);
  });
});

describe("«Где» in the search panel", () => {
  const KRASNODAR = { slug: "krasnodar", name: "Краснодар", geo: { region: "krasnodar", centre: CENTRE, token: "tp" } };
  const KAZAN = { slug: "kazan", name: "Казань", geo: null };
  const whereInputs = () => screen.queryAllByRole("combobox").filter((el) => el.id.startsWith("where-"));

  it("is not rendered at all in a city without geodata", () => {
    url.pathname = "/kazan";
    url.search = "";
    render(<HeaderSearch cities={[KRASNODAR, KAZAN]} />);
    expect(whereInputs()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: new RegExp(`^${t.label}:`) })).toBeNull();
  });

  it("shows the point from the address and submits it with the search", () => {
    url.pathname = "/krasnodar";
    url.search = "loc=p:44.988,38.948&la=Яблоновский&lp=t";
    render(<HeaderSearch cities={[KRASNODAR, KAZAN]} />);
    expect(whereInputs()[0]).toHaveValue("Яблоновский");
    const form = screen.getByRole("search");
    expect(form.querySelector('input[type="hidden"][name="loc"]')).toHaveValue("p:44.988,38.948");

    fireEvent.change(screen.getByRole("combobox", { name: content.search.whatLabel }), { target: { value: "дрель" } });
    fireEvent.submit(form);
    const dest = new URL(push.mock.lastCall![0] as string, "http://x");
    expect(Object.fromEntries(dest.searchParams)).toEqual({
      q: "дрель", city: "krasnodar", loc: "p:44.988,38.948", la: "Яблоновский", lp: "t",
    });
  });

  it("a picked address goes into the search: rounded to three decimals", async () => {
    url.pathname = "/krasnodar/instrumenty";
    url.search = "";
    render(<HeaderSearch cities={[KRASNODAR]} />);
    const where = whereInputs()[0];
    fireEvent.focus(where);
    fireEvent.change(where, { target: { value: "красная 120" } });
    await waitFor(() => expect(options()[0]).toHaveTextContent("улица Красная, 120"));
    fireEvent.click(options()[0]);
    fireEvent.submit(screen.getByRole("search"));
    await waitFor(() => expect(push).toHaveBeenCalled());
    const dest = new URL(push.mock.lastCall![0] as string, "http://x");
    expect(dest.pathname).toBe("/krasnodar/instrumenty");
    expect(dest.searchParams.get("loc")).toMatch(/^p:\d+\.\d{3},\d+\.\d{3}$/);
    expect(dest.searchParams.get("la")).toBe("улица Красная, 120, Краснодар");
  });

  it("Enter on a typed address resolves it before the search leaves", async () => {
    url.pathname = "/krasnodar";
    url.search = "";
    render(<HeaderSearch cities={[KRASNODAR]} />);
    const where = whereInputs()[0];
    fireEvent.focus(where);
    fireEvent.change(where, { target: { value: "ставропольская" } });
    fireEvent.keyDown(where, { key: "Enter" });
    await waitFor(() => expect(push).toHaveBeenCalled());
    const dest = new URL(push.mock.lastCall![0] as string, "http://x");
    expect(dest.pathname).toBe("/krasnodar");
    expect(dest.searchParams.get("la")).toBe("улица Ставропольская, Краснодар");
    expect(dest.searchParams.get("lp")).toBe("s");
  });

  it("«×» removes the point from the address of the search", () => {
    url.pathname = "/krasnodar";
    url.search = "loc=p:44.988,38.948&la=Яблоновский&lp=t&sort=near";
    render(<HeaderSearch cities={[KRASNODAR]} />);
    fireEvent.click(screen.getByRole("button", { name: content.address.clear }));
    fireEvent.submit(screen.getByRole("search"));
    expect(push).toHaveBeenLastCalledWith("/krasnodar");
  });

  // «Что» с точкой ищет по всему региону — как выдача по тому же адресу.
  it("«Что» suggestions are asked with the point", async () => {
    url.pathname = "/krasnodar";
    url.search = "loc=p:44.988,38.948&la=Яблоновский&lp=t";
    render(<HeaderSearch cities={[KRASNODAR]} />);
    const what = screen.getByRole("combobox", { name: content.search.whatLabel });
    fireEvent.focus(what);
    fireEvent.change(what, { target: { value: "дрель" } });
    await waitFor(() => expect(calls.some((u) => u.pathname === "/api/search/suggest" && u.searchParams.get("q") === "дрель")).toBe(true));
    const req = calls.find((u) => u.pathname === "/api/search/suggest" && u.searchParams.get("q") === "дрель")!;
    expect(req.searchParams.get("loc")).toBe("p:44.988,38.948");
    expect(req.searchParams.get("lp")).toBe("t");
  });
});
