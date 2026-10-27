import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GOALS, GOAL_QUEUE_LIMIT, _pendingGoalsForTests, _resetGoalsForTests, reachGoal, startGoals, stopGoals,
  type Goal,
} from "@/components/analytics/goals";

// Цели Метрики: свой список, своя очередь до подъёма счётчика, параметры только
// из закрытого списка значений.
let ym: ReturnType<typeof vi.fn>;
beforeEach(() => {
  _resetGoalsForTests();
  ym = vi.fn();
  window.ym = ym;
});
afterEach(() => {
  delete window.ym;
});

// Нестрогий вызов: проверить, что рантайм отбрасывает то, что не пропустили бы типы.
const loose = reachGoal as (name: string, params?: unknown) => void;

describe("список целей", () => {
  it("ровно десять целей владельца", () => {
    expect([...GOALS].sort()).toEqual([
      "booking_click", "booking_sent", "chat_started", "listing_created", "listing_started",
      "listing_view", "search", "search_zero", "signup", "tg_booking_click",
    ]);
  });

  // Идентификатор JS-цели в Метрике не может содержать / \ & # ? = ".
  it.each(GOALS)("%s — допустимый идентификатор JS-цели", (goal) => {
    expect(goal).not.toMatch(/[/\\&#?="]/);
    expect(goal).toMatch(/^[a-z_]{1,64}$/);
  });
});

describe("очередь до подъёма счётчика", () => {
  it("копит цели и отдаёт их счётчику по порядку при старте", () => {
    reachGoal("listing_view");
    reachGoal("search", { kind: "text" });
    expect(ym).not.toHaveBeenCalled();

    startGoals(42);
    expect(ym.mock.calls).toEqual([
      [42, "reachGoal", "listing_view"],
      [42, "reachGoal", "search", { kind: "text" }],
    ]);
    expect(_pendingGoalsForTests()).toEqual([]);
  });

  it("после старта шлёт сразу", () => {
    startGoals(42);
    reachGoal("booking_click", { authed: false });
    expect(ym).toHaveBeenCalledWith(42, "reachGoal", "booking_click", { authed: false });
  });

  it("повторный старт не шлёт очередь второй раз", () => {
    reachGoal("booking_sent");
    startGoals(42);
    startGoals(42);
    expect(ym).toHaveBeenCalledTimes(1);
  });

  it(`ограничена ${GOAL_QUEUE_LIMIT} вызовами: лишние отбрасываются`, () => {
    for (let i = 0; i < GOAL_QUEUE_LIMIT + 5; i++) reachGoal("listing_view");
    expect(_pendingGoalsForTests()).toHaveLength(GOAL_QUEUE_LIMIT);
    startGoals(42);
    expect(ym).toHaveBeenCalledTimes(GOAL_QUEUE_LIMIT);
  });

  it("без счётчика (dev без id) никуда не уходит", () => {
    reachGoal("listing_created");
    expect(ym).not.toHaveBeenCalled();
  });
});

describe("Метрика выключена (админка)", () => {
  it("очередь отбрасывается, новые цели не уходят", () => {
    reachGoal("listing_view");
    stopGoals();
    reachGoal("booking_sent");
    expect(_pendingGoalsForTests()).toEqual([]);
    expect(ym).not.toHaveBeenCalled();
  });
});

describe("параметры", () => {
  beforeEach(() => startGoals(7));
  const lastParams = () => ym.mock.calls.at(-1)?.[3];

  it("текст запроса не проходит ни значением, ни лишним ключом", () => {
    loose("search", { kind: "перфоратор" });
    expect(lastParams()).toBeUndefined();
    loose("search", { kind: "text", q: "перфоратор makita" });
    expect(lastParams()).toEqual({ kind: "text" });
    // Латиница в нижнем регистре похожа на идентификатор — значения всё равно
    // из закрытого списка.
    loose("search", { kind: "drill" });
    expect(lastParams()).toBeUndefined();
  });

  it("почта, телефон и id не проходят", () => {
    loose("signup", { method: "user@mail.ru" });
    expect(lastParams()).toBeUndefined();
    loose("booking_sent", { phone: "+79000000000", listingId: "01ARZ3NDEKTSV4RRFFQ69G5FAW" });
    expect(ym).toHaveBeenLastCalledWith(7, "reachGoal", "booking_sent");
  });

  it("булево — только у authed, и только булево", () => {
    loose("booking_click", { authed: "yes" });
    expect(lastParams()).toBeUndefined();
    reachGoal("booking_click", { authed: true });
    expect(lastParams()).toEqual({ authed: true });
  });

  it("причина пустой выдачи и способ регистрации — из своих списков", () => {
    reachGoal("search_zero", { reason: "no_match" });
    expect(lastParams()).toEqual({ reason: "no_match" });
    reachGoal("signup", { method: "vk" });
    expect(lastParams()).toEqual({ method: "vk" });
  });

  it("неизвестная цель не уходит", () => {
    loose("constructor");
    loose("toString");
    loose("purchase");
    expect(ym).not.toHaveBeenCalled();
  });
});

it("сбой счётчика не ломает вызов", () => {
  startGoals(1);
  window.ym = () => { throw new Error("ym"); };
  expect(() => reachGoal("listing_view")).not.toThrow();
});

// Типы — та же граница, что и рантайм: проверка идёт в `tsc --noEmit`.
export function typeChecks(goal: Goal) {
  reachGoal("listing_view");
  reachGoal("search", { kind: "category" });
  // @ts-expect-error у search обязателен kind
  reachGoal("search");
  // @ts-expect-error kind из закрытого списка
  reachGoal("search", { kind: "дрель" });
  // @ts-expect-error у listing_view параметров нет
  reachGoal("listing_view", { kind: "text" });
  // @ts-expect-error authed — булево
  reachGoal("booking_click", { authed: "true" });
  // @ts-expect-error причины нет в списке
  reachGoal("search_zero", { reason: "nothing" });
  return goal;
}
