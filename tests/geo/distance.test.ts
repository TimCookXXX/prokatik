import { describe, expect, it } from "vitest";
import { DISTANCE_TITLE, distanceLabel } from "@/lib/geo/distance";

// Подпись расстояния (план поиска, §3): точное — метры, км с одним знаком,
// целые км; приблизительное — «≈» и целые км, не меньше одного.
describe("distanceLabel", () => {
  it("approximate: «≈» and whole km, at least one", () => {
    expect(distanceLabel(0.2, true)).toBe("≈ 1 км");
    expect(distanceLabel(2.6, true)).toBe("≈ 3 км");
    expect(distanceLabel(14.4, true)).toBe("≈ 14 км");
  });

  it("exact under 1 km: metres in steps of 100, at least 100", () => {
    expect(distanceLabel(0, false)).toBe("100 м");
    expect(distanceLabel(0.04, false)).toBe("100 м");
    expect(distanceLabel(0.36, false)).toBe("400 м");
    expect(distanceLabel(0.94, false)).toBe("900 м");
  });

  // Порог по округлённому: 0,97 км — это «1 км», а не «1000 м».
  it("rounds across the 1 km threshold into kilometres", () => {
    expect(distanceLabel(0.97, false)).toBe("1 км");
  });

  it("exact 1–10 km: one decimal with a comma", () => {
    expect(distanceLabel(1.23, false)).toBe("1,2 км");
    expect(distanceLabel(3.05, false)).toBe("3,1 км");
    expect(distanceLabel(9.94, false)).toBe("9,9 км");
  });

  it("exact from 10 km: whole km", () => {
    expect(distanceLabel(9.96, false)).toBe("10 км");
    expect(distanceLabel(12.4, false)).toBe("12 км");
    expect(distanceLabel(38.6, false)).toBe("39 км");
  });

  it("titles the label as a straight line", () => {
    expect(DISTANCE_TITLE).toBe("по прямой");
  });
});
