import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Footer } from "@/components/layout/Footer";
import { content } from "@theme/content";

describe("<Footer>", () => {
  it("содержит disclaimer и ссылку на /privacy", () => {
    const { container, getByText } = render(<Footer />);
    expect(container.textContent).toContain(content.footer.disclaimer);
    const link = getByText(content.footer.privacyLink) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/privacy");
  });

  it("атрибутирует OSM и ГАР и ведёт на /sources", () => {
    const { container, getByText } = render(<Footer />);
    const credits = content.footer.dataCredits;
    const osm = getByText(credits.osm) as HTMLAnchorElement;
    expect(osm.getAttribute("href")).toBe("https://www.openstreetmap.org/copyright");
    expect(container.textContent).toContain(credits.gar);
    expect(container.textContent).toContain("ГАР ФНС России");
    const sources = getByText(credits.sources) as HTMLAnchorElement;
    expect(sources.getAttribute("href")).toBe("/sources");
  });

  it("ставит на города обычные ссылки на их витрины", () => {
    const { getByRole } = render(
      <Footer cities={[
        { slug: "krasnodar", name: "Краснодар" },
        { slug: "yablonovskiy", name: "Яблоновский" },
      ]} />,
    );
    const nav = getByRole("navigation", { name: content.footer.citiesTitle });
    const links = [...nav.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([["Краснодар", "/krasnodar"], ["Яблоновский", "/yablonovskiy"]]);
  });

  it("без городов колонки нет", () => {
    const { queryByRole, container } = render(<Footer cities={[]} />);
    expect(queryByRole("navigation", { name: content.footer.citiesTitle })).toBeNull();
    expect(container.textContent).not.toContain(content.footer.citiesTitle);
  });

  // Сетка на мобайле — два столбца при любом числе колонок: пятая колонка не
  // должна расширять подвал вбок, на lg добавляется ровно один столбец.
  it("на мобайле две колонки, на десктопе колонка городов добавляет столбец", () => {
    const grid = (cities: { slug: string; name: string }[]) =>
      render(<Footer cities={cities} />).container.querySelector("footer .grid")!.className;
    const withCities = grid([{ slug: "krasnodar", name: "Краснодар" }]);
    expect(withCities).toContain("grid-cols-2");
    expect(withCities).toContain("lg:grid-cols-[1.5fr_repeat(4,1fr)]");
    expect(grid([])).toContain("lg:grid-cols-[1.5fr_repeat(3,1fr)]");
  });
});
