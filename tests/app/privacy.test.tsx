import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import PrivacyPage, { generateMetadata } from "@/app/(public)/privacy/page";
import { content } from "@theme/content";

describe("/privacy", () => {
  it("содержит контактный email и упоминание Метрики", () => {
    const { container, getByText } = render(<PrivacyPage />);
    expect(container.textContent).toContain(content.site.contactEmail);
    expect(container.textContent?.toLowerCase()).toMatch(/метрик/);
    expect(getByText(content.privacy.title)).toBeTruthy();
  });

  it("описание — вводный абзац, canonical абсолютный", () => {
    const metadata = generateMetadata();
    expect(metadata.description).toBe(content.privacy.intro);
    expect(metadata.alternates?.canonical).toBe(`${process.env.NEXTAUTH_URL!.replace(/\/$/, "")}/privacy`);
    expect(metadata.robots).toBeUndefined();
  });
});
