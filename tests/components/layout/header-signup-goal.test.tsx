import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Цель «Зарегистрировался» рисует шапка: она в корневом layout'е и первой
// видит сессию после возвращения с провайдера или по ссылке из письма.
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/server/catalog", () => ({ getActiveCities: vi.fn(async () => [{ id: "1", slug: "msk", name: "Москва" }]) }));
vi.mock("@/server/city", () => ({ getCitiesGeo: vi.fn(async () => new Map()) }));
vi.mock("@/server/actions/city", () => ({ setCityPreference: vi.fn() }));
vi.mock("@/components/auth/useSignOut", () => ({ useSignOut: () => ({ pending: false, run: vi.fn() }) }));
// accounts нового аккаунта: Яндекс.
const db = vi.hoisted(() => ({ selects: 0 }));
vi.mock("@/lib/db", () => {
  const chain: unknown = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") return (resolve: (rows: unknown[]) => void) => { db.selects++; resolve([{ provider: "yandex" }]); };
      return () => chain;
    },
  });
  return { getDb: () => ({ select: () => chain }) };
});
const reachGoal = vi.hoisted(() => vi.fn());
vi.mock("@/components/analytics/goals", () => ({ reachGoal }));

import { Header } from "@/components/layout/Header";
import { CityPreferenceProvider } from "@/components/layout/CityPreference";

// Сессия выдана вслед за созданием аккаунта — возврат с провайдера.
const session = (createdAt: string, sessionIssuedAt = createdAt) => ({
  user: {
    id: "u1", name: "Аня", email: "a@ya.ru", image: null, role: "user", bannedAt: null, banReason: null,
    signup: { createdAt, emailVerified: null, sessionIssuedAt },
  },
});

beforeEach(() => {
  reachGoal.mockClear();
  authMock.mockReset();
  db.selects = 0;
  localStorage.clear();
});

const renderHeader = async () =>
  render(<CityPreferenceProvider initialSlug="msk">{await Header()}</CityPreferenceProvider>);

describe("Header: цель signup", () => {
  it("аккаунт создан только что — signup со способом входа", async () => {
    authMock.mockResolvedValue(session(new Date(Date.now() - 60_000).toISOString()));
    await renderHeader();
    expect(reachGoal.mock.calls).toEqual([["signup", { method: "yandex" }]]);
  });

  it("давний аккаунт — цели нет и в accounts шапка не ходит", async () => {
    authMock.mockResolvedValue(session("2026-01-01T00:00:00.000Z"));
    await renderHeader();
    expect(reachGoal).not.toHaveBeenCalled();
    expect(db.selects).toBe(0);
  });

  it("свежий аккаунт, но сессия выдана позже — вход с другого устройства, цели нет", async () => {
    const created = Date.now() - 10 * 60_000;
    authMock.mockResolvedValue(session(new Date(created).toISOString(), new Date(created + 5 * 60_000).toISOString()));
    await renderHeader();
    expect(reachGoal).not.toHaveBeenCalled();
    expect(db.selects).toBe(0);
  });

  it("гость — цели нет", async () => {
    authMock.mockResolvedValue(null);
    await renderHeader();
    expect(reachGoal).not.toHaveBeenCalled();
  });
});
