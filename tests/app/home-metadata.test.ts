// Главная: canonical абсолютный, от NEXTAUTH_URL, и заголовок без шаблона.
import { describe, expect, it, vi } from "vitest";
import { seo } from "@theme/seo";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/server/catalog", () => ({}));
vi.mock("@/server/city", () => ({}));
vi.mock("@/server/search", () => ({}));

const { generateMetadata } = await import("@/app/(public)/page");

describe("метаданные главной", () => {
  it("canonical — корень сайта, title absolute", () => {
    const metadata = generateMetadata();
    expect(metadata.alternates?.canonical).toBe(`${process.env.NEXTAUTH_URL!.replace(/\/$/, "")}/`);
    expect(metadata.title).toEqual({ absolute: seo.defaultTitle });
  });
});
