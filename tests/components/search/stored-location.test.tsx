// Последнее место «Где» — маленький внешний стор над localStorage: поля «Где»
// видят запись и очистку сразу, соседняя вкладка — через событие storage.
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readStoredLocation, storeLocation, subscribeStoredLocation, useStoredLocation,
} from "@/components/search/stored-location";
import type { UserPoint } from "@/lib/geo/location";

const POINT: UserPoint = {
  point: { lat: 45.03512, lon: 38.97534 }, label: "улица Красная", source: "address", precision: "street",
};

afterEach(() => localStorage.clear());

function Probe({ region }: { region: string }) {
  const p = useStoredLocation(region);
  return <p data-testid="probe">{p ? `${p.label} ${p.point.lat},${p.point.lon}` : "none"}</p>;
}

describe("stored location", () => {
  it("remembers a point of its region rounded like the address bar, and forgets it", () => {
    storeLocation("krasnodar", POINT);
    expect(readStoredLocation("krasnodar")).toEqual({ ...POINT, point: { lat: 45.035, lon: 38.975 } });
    // Другой регион — не его место.
    expect(readStoredLocation("adygea")).toBeNull();

    storeLocation("krasnodar", null);
    expect(readStoredLocation("krasnodar")).toBeNull();
  });

  it("notifies subscribers on store and clear until they unsubscribe", () => {
    const cb = vi.fn();
    const off = subscribeStoredLocation(cb);
    storeLocation("krasnodar", POINT);
    storeLocation("krasnodar", null);
    expect(cb).toHaveBeenCalledTimes(2);

    off();
    storeLocation("krasnodar", POINT);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("re-renders readers on a write in this tab and in another one", () => {
    render(<Probe region="krasnodar" />);
    expect(screen.getByTestId("probe")).toHaveTextContent("none");

    act(() => storeLocation("krasnodar", POINT));
    expect(screen.getByTestId("probe")).toHaveTextContent("улица Красная 45.035,38.975");

    // Соседняя вкладка очистила место: событие storage приходит сюда.
    act(() => {
      localStorage.removeItem("inrenta_loc");
      window.dispatchEvent(new StorageEvent("storage", { key: "inrenta_loc" }));
    });
    expect(screen.getByTestId("probe")).toHaveTextContent("none");
  });

  it("ignores storage events of other keys", () => {
    const cb = vi.fn();
    const off = subscribeStoredLocation(cb);
    window.dispatchEvent(new StorageEvent("storage", { key: "theme" }));
    expect(cb).not.toHaveBeenCalled();
    off();
  });

  it("reads a point of another region as none", () => {
    storeLocation("adygea", POINT);
    render(<Probe region="krasnodar" />);
    expect(screen.getByTestId("probe")).toHaveTextContent("none");
  });
});
