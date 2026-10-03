import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import SourcesPage, { metadata } from "@/app/(public)/sources/page";
import { content } from "@theme/content";

describe("/sources", () => {
  it("называет OSM с лицензией ODbL, ГАР и предлагает базу по запросу", () => {
    const { container, getByText } = render(<SourcesPage />);
    const text = container.textContent ?? "";
    expect(getByText(content.sources.title)).toBeTruthy();

    const osm = getByText(content.sources.osm.credit) as HTMLAnchorElement;
    expect(osm.getAttribute("href")).toBe("https://www.openstreetmap.org/copyright");
    const odbl = getByText(content.sources.database.license) as HTMLAnchorElement;
    expect(odbl.getAttribute("href")).toBe("https://opendatacommons.org/licenses/odbl/1-0/");
    expect(text).toContain("ГАР ФНС России");

    // ODbL 4.6: предложение копии базы и куда за ней писать.
    expect(text).toMatch(/по запросу/);
    const email = getByText(content.site.contactEmail) as HTMLAnchorElement;
    expect(email.getAttribute("href")).toBe(`mailto:${content.site.contactEmail}`);
  });

  it("индексируется: метаданные без robots", () => {
    expect(metadata.title).toBe(content.sources.title);
    expect(metadata.robots).toBeUndefined();
  });
});
