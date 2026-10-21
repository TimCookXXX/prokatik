import { StrictMode } from "react";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reachGoal = vi.hoisted(() => vi.fn());
vi.mock("@/components/analytics/goals", () => ({ reachGoal }));

import { SIGNUP_GOAL_KEY_PREFIX, SignupGoal } from "@/components/analytics/SignupGoal";

beforeEach(() => reachGoal.mockClear());
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("<SignupGoal>", () => {
  it("шлёт signup со способом один раз, и под StrictMode тоже", () => {
    render(<StrictMode><SignupGoal account="u1" method="yandex" /></StrictMode>);
    expect(reachGoal).toHaveBeenCalledTimes(1);
    expect(reachGoal).toHaveBeenCalledWith("signup", { method: "yandex" });
  });

  it("один раз на аккаунт на устройстве: следующая загрузка страницы не шлёт", () => {
    render(<SignupGoal account="u1" method="email" />).unmount();
    render(<SignupGoal account="u1" method="email" />);
    expect(reachGoal).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(`${SIGNUP_GOAL_KEY_PREFIX}u1`)).toBe("1");
  });

  it("другой аккаунт на том же устройстве — своя цель", () => {
    render(<SignupGoal account="u1" method="email" />).unmount();
    render(<SignupGoal account="u2" method="vk" />);
    expect(reachGoal).toHaveBeenCalledTimes(2);
    expect(reachGoal).toHaveBeenLastCalledWith("signup", { method: "vk" });
  });

  it("без хранилища цели нет: иначе каждая перезагрузка — новая регистрация", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    render(<SignupGoal account="u1" method="email" />);
    expect(reachGoal).not.toHaveBeenCalled();
  });
});
