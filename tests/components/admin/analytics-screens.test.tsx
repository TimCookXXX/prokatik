// Экраны «Аналитики» в админке: что видно на телефоне и ноутбуке и куда ведут
// ссылки. Данные — моками чтений: проверяется вёрстка и порядок блоков.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, within } from "@testing-library/react";

const reads = vi.hoisted(() => ({
  adminVisitorSummary: vi.fn(),
  adminListVisitors: vi.fn(),
  adminVisitorCard: vi.fn(),
}));
vi.mock("@/server/analytics-admin", () => ({ ...reads, CARD_EVENTS_MAX: 1000 }));
vi.mock("@/lib/auth/assert-admin", () => ({ assertAdmin: vi.fn(async () => {}) }));
vi.mock("@/server/actions/analytics-admin", () => ({ adminSetVisitorInternal: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import AdminVisitorsPage from "@/app/(app)/admin/visitors/page";
import AdminVisitorPage from "@/app/(app)/admin/visitors/[id]/page";
import VisitorNotFound from "@/app/(app)/admin/visitors/[id]/not-found";
import { DaysTable } from "@/components/admin/analytics/DaysTable";
import { StatTable } from "@/components/admin/analytics/StatTable";
import { content } from "@theme/content";

const t = content.adminAnalytics;
const VID = "d7540424-a1c8-4e80-bb7f-38368f5406b2";
const ZERO = { people: 0, new: 0, returned: 0, searched: 0, zero: 0, viewed: 0, clicked: 0, requested: 0, signups: 0 };
const SUMMARY = { since: "2026-10-15", today: "2026-10-21", totals: ZERO, days: [{ day: "2026-10-21", ...ZERO }], capReached: false };
const ROW = {
  id: VID, firstSeenAt: new Date("2026-10-21T08:00:00Z"), lastSeenAt: new Date("2026-10-21T09:00:00Z"),
  personFirstSeenAt: new Date("2026-10-21T08:00:00Z"), continued: false,
  userId: null, userName: null, userEmail: null, firstSource: null, device: "phone",
  isBot: false, isInternal: false, searches: 0, views: 0, days: 1,
};

beforeEach(() => {
  reads.adminVisitorSummary.mockReset().mockResolvedValue(SUMMARY);
  reads.adminListVisitors.mockReset().mockResolvedValue({ rows: [ROW], newer: null, older: null, user: null });
  reads.adminVisitorCard.mockReset();
});

const page = async (sp: Record<string, string>) => render(await AdminVisitorsPage({ searchParams: Promise.resolve(sp) }));

describe("/admin/visitors", () => {
  it("без фильтров — сводка и таблица по дням, ссылка к списку", async () => {
    const { container } = await page({});
    expect(reads.adminVisitorSummary).toHaveBeenCalledTimes(1);
    expect(container.querySelector("#summary")).not.toBeNull();
    expect(container.querySelector("#days")).not.toBeNull();
    expect(container.querySelector('a[href="#guests"]')).not.toBeNull();
  });

  // Записи одного аккаунта, поиск и листание — про гостей: сводка по всему
  // сайту сдвигала бы список на полтора экрана и читалась бы как цифры человека.
  it.each([
    ["записи аккаунта", { user: "01M41FHZ2YNPA2MT6MSGD8PSZE" }],
    ["поиск гостя", { find: "1697712345123456789" }],
    ["страница списка", { after: `2026-10-21T10:00:00.000004_${VID}` }],
  ])("%s — сразу список, без сводки по сайту", async (_name, sp) => {
    const { container } = await page(sp);
    expect(reads.adminVisitorSummary).not.toHaveBeenCalled();
    expect(container.querySelector("#summary")).toBeNull();
    expect(container.querySelector("#days")).toBeNull();
    expect(container.querySelector("#guests")).not.toBeNull();
  });

  it("записи аккаунта — с пояснением, что запись — это вход, а не устройство", async () => {
    const { getByText } = await page({ user: "01M41FHZ2YNPA2MT6MSGD8PSZE" });
    expect(getByText(t.list.userNote)).toBeTruthy();
  });

  // Карточка возвращает на ту же страницу списка.
  it("ссылка на карточку несёт период, фильтр и страницу списка", async () => {
    const after = `2026-10-21T10:00:00.000004_${VID}`;
    const { container } = await page({ period: "30", all: "1", user: "u1", after });
    const link = container.querySelector(`a[href^="/admin/visitors/${VID}"]`)!;
    const url = new URL(link.getAttribute("href")!, "http://x");
    expect(url.searchParams.get("period")).toBe("30");
    expect(url.searchParams.get("all")).toBe("1");
    expect(url.searchParams.get("user")).toBe("u1");
    expect(url.searchParams.get("after")).toBe(after);
  });
});

describe("/admin/visitors/[id]", () => {
  const event = (id: string, type: string, props: Record<string, unknown>) => ({
    id, type, at: ROW.firstSeenAt, path: type === "pageview" ? "/" : null, listingId: null, listingTitle: null,
    q: null, total: null, props, userId: null,
  });
  const CARD = {
    visitor: {
      id: VID, firstSeenAt: ROW.firstSeenAt, lastSeenAt: ROW.lastSeenAt, personFirstSeenAt: ROW.firstSeenAt,
      continued: false, days: 3, firstSource: null, device: "phone", ymClientId: "777", isBot: false, isInternal: false,
    },
    user: null,
    events: [
      event("E1", "pageview", { doc: true }),
      event("E2", "ym_client", { cid: "555" }),
      event("E3", "ym_client", { cid: "777" }),
    ],
    truncated: false,
    actions: [],
    signupLoginId: null,
    directory: { cities: new Map(), categories: new Map(), listings: new Map() },
  };
  const card = async (sp: Record<string, string> = {}) =>
    render(await AdminVisitorPage({ params: Promise.resolve({ id: VID }), searchParams: Promise.resolve(sp) }));

  it("«← Все гости» — на ту же страницу списка", async () => {
    reads.adminVisitorCard.mockResolvedValue(CARD);
    const { getByText } = await card({ period: "30", user: "u1" });
    expect(getByText(t.visitor.back).getAttribute("href")).toBe("/admin/visitors?period=30&user=u1");
  });

  it("дни — из чтения, а не из загруженных событий; нынешний ClientID — только в шапке", async () => {
    reads.adminVisitorCard.mockResolvedValue(CARD);
    const { container } = await card();
    const facts = container.querySelector("dl") as HTMLElement;
    expect(within(facts).getByText(t.visitor.days).nextElementSibling?.textContent).toBe("3");
    const timeline = container.querySelector("#timeline")!.parentElement!;
    expect(timeline.textContent).not.toContain("777");
    expect(timeline.textContent).toContain("555");
  });

  it("на телефоне факты — в две колонки", async () => {
    reads.adminVisitorCard.mockResolvedValue(CARD);
    const { container } = await card();
    expect(container.querySelector("dl")!.className).toMatch(/(^|\s)grid-cols-2(\s|$)/);
  });

  it("нет такого браузера — notFound(), его ловит not-found сегмента с объяснением", async () => {
    reads.adminVisitorCard.mockResolvedValue(null);
    await expect(card()).rejects.toThrow("NEXT_NOT_FOUND");
    const { getByText } = render(<VisitorNotFound />);
    expect(getByText(t.visitor.notFound)).toBeTruthy();
    expect(getByText(t.visitor.back).getAttribute("href")).toBe("/admin/visitors");
  });
});

describe("таблицы", () => {
  // На ноутбуке колонка админки уже таблицы с капсом и разрядкой: подписи
  // переносятся по словам, «регистрации» не прячется за прокруткой.
  it("по дням: подписи без капса и разрядки, день прилипает слева", () => {
    const { container } = render(<DaysTable days={SUMMARY.days} today={SUMMARY.today} />);
    expect(container.querySelector("thead tr")!.className).not.toMatch(/uppercase|tracking-mono/);
    expect(container.querySelector("thead th")!.className).toMatch(/sticky left-0/);
    expect(container.querySelector("tbody th")!.className).toMatch(/sticky left-0 .*bg-card/);
  });

  // На телефоне таблица шире экрана прятала бы число людей за прокруткой.
  it("«Поиски» на телефоне — карточками со всеми числами, таблица — с sm", () => {
    const { container } = render(
      <StatTable
        rows={[{ q: "лодка пвх", people: 2, times: 3 }]}
        columns={[
          { key: "q", label: "запрос", cell: (r) => r.q },
          { key: "people", label: "человек", numeric: true, cell: (r) => r.people },
          { key: "times", label: "раз", numeric: true, cell: (r) => r.times },
        ]}
        rowKey={(r) => r.q}
      />,
    );
    const cards = container.querySelector("ul")!;
    expect(cards.className).toMatch(/sm:hidden/);
    expect(cards.textContent).toBe("лодка пвхчеловек: 2 · раз: 3");
    expect(container.querySelector("table")!.parentElement!.className).toMatch(/hidden .*sm:block/);
  });
});
