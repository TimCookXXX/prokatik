// Событие показа серверной страницы: один раз на показ, и под StrictMode
// тоже; перерисовка с тем же ключом — тот же показ. У выдачи цель Метрики —
// по своему ключу.
import { StrictMode } from "react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const track = vi.hoisted(() => vi.fn());
vi.mock("@/components/analytics/track", () => ({ track }));

import { TrackOnMount } from "@/components/analytics/TrackOnMount";

beforeEach(() => track.mockClear());

describe("<TrackOnMount>", () => {
  it("объявление: одно событие при монтировании, и под StrictMode тоже", () => {
    render(<StrictMode><TrackOnMount event="view_listing" token="T1" showKey="L1" /></StrictMode>);
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("view_listing", { token: "T1" }, { goal: true });
  });

  // Перерисовка после заявки (Server Action, router.refresh) приносит новый
  // токен — новое время подписи, — но это тот же показ.
  it("перерисовка с тем же ключом и новым токеном — без повтора", () => {
    const { rerender } = render(<TrackOnMount event="view_listing" token="T1" showKey="L1" />);
    rerender(<TrackOnMount event="view_listing" token="T2" showKey="L1" />);
    expect(track).toHaveBeenCalledTimes(1);
  });

  it("выдача: новый ключ — новое событие; цель — только при новом ключе цели", () => {
    const { rerender } = render(
      <TrackOnMount event="search" token="S1" showKey="q=a" goalKey="q=a" zero="no_match" />,
    );
    expect(track).toHaveBeenLastCalledWith("search", { token: "S1", zero: "no_match" }, { goal: true });
    // Сортировка: показ новый, цель та же.
    rerender(<TrackOnMount event="search" token="S2" showKey="q=a&sort=new" goalKey="q=a" zero="no_match" />);
    expect(track).toHaveBeenLastCalledWith("search", { token: "S2", zero: "no_match" }, { goal: false });
    // Новые условия — и событие, и цель.
    rerender(<TrackOnMount event="search" token="S3" showKey="q=b" goalKey="q=b" zero="filtered" />);
    expect(track).toHaveBeenLastCalledWith("search", { token: "S3", zero: "filtered" }, { goal: true });
    expect(track).toHaveBeenCalledTimes(3);
  });
});
