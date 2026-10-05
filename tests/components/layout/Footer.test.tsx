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
});
