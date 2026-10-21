import { StrictMode } from "react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const reachGoal = vi.hoisted(() => vi.fn());
vi.mock("@/components/analytics/goals", () => ({ reachGoal }));

import { GoalOnMount } from "@/components/analytics/GoalOnMount";

beforeEach(() => reachGoal.mockClear());

describe("<GoalOnMount>", () => {
  it("шлёт цель один раз при монтировании, и под StrictMode тоже", () => {
    render(<StrictMode><GoalOnMount goal="listing_view" showKey="L1" /></StrictMode>);
    expect(reachGoal).toHaveBeenCalledTimes(1);
    expect(reachGoal).toHaveBeenCalledWith("listing_view", undefined);
  });

  // Перерисовка после Server Action или router.refresh приносит новые объекты
  // пропсов, но это тот же показ.
  it("не шлёт повторно на перерисовке с тем же ключом", () => {
    const { rerender } = render(<GoalOnMount goal="search_zero" params={{ reason: "no_match" }} showKey="q=a" />);
    rerender(<GoalOnMount goal="search_zero" params={{ reason: "no_match" }} showKey="q=a" />);
    expect(reachGoal).toHaveBeenCalledTimes(1);
    expect(reachGoal).toHaveBeenCalledWith("search_zero", { reason: "no_match" });
  });

  it("шлёт снова на смене ключа: новые условия — новый показ", () => {
    const { rerender } = render(<GoalOnMount goal="search_zero" params={{ reason: "no_match" }} showKey="q=a" />);
    rerender(<GoalOnMount goal="search_zero" params={{ reason: "filtered" }} showKey="q=a&from=x" />);
    expect(reachGoal).toHaveBeenCalledTimes(2);
    expect(reachGoal).toHaveBeenLastCalledWith("search_zero", { reason: "filtered" });
  });
});
