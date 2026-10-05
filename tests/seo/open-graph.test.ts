import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { OG_SIZE, tokenColor } from "@/lib/seo/og-image";

// Open Graph: общая часть в корневом layout, картинка по умолчанию — файловая
// конвенция src/app/opengraph-image.tsx со шрифтом и цветами из репозитория.

vi.mock("@/server/city", () => ({ resolveViewerCity: vi.fn() }));
vi.mock("@/components/layout/Header", () => ({ Header: () => null }));
vi.mock("@/components/layout/MobileNav", () => ({ MobileNav: () => null }));
vi.mock("@/components/layout/Footer", () => ({ Footer: () => null }));
vi.mock("@/components/realtime/RealtimeProvider", () => ({ RealtimeProvider: () => null }));
vi.mock("@/components/realtime/RealtimeToaster", () => ({ RealtimeToaster: () => null }));
vi.mock("@/components/realtime/ConnectionStatus", () => ({ ConnectionStatus: () => null }));
vi.mock("@theme/fonts", () => ({ fontDisplay: {}, fontText: {}, fontMark: {}, fontMono: {} }));

describe("метаданные корневого layout", () => {
  it("metadataBase от NEXTAUTH_URL, общий openGraph без images, twitter card", async () => {
    const { generateMetadata } = await import("@/app/layout");
    const meta = generateMetadata();
    expect(String(meta.metadataBase)).toBe(new URL(process.env.NEXTAUTH_URL!).toString());
    // images здесь быть не должно: иначе Next не подставит opengraph-image.
    expect(meta.openGraph).toEqual({ type: "website", siteName: "inrenta", locale: "ru_RU" });
    expect(meta.twitter).toEqual({ card: "summary_large_image" });
    expect(meta.icons).toBeUndefined();
  });
});

describe("картинка по умолчанию", () => {
  it("лежит в корне app и рисуется локальным TTF, без сетевых запросов", () => {
    const src = readFileSync(join(process.cwd(), "src/app/opengraph-image.tsx"), "utf8");
    expect(src).not.toMatch(/fetch\(|https?:\/\/fonts\./);
    const font = readFileSync(join(process.cwd(), "theme/brand/fonts/SpaceGrotesk-Bold.ttf"));
    // TrueType: 00 01 00 00. woff2 next/og не читает.
    expect([...font.subarray(0, 4)]).toEqual([0, 1, 0, 0]);
    expect(existsSync(join(process.cwd(), "theme/brand/fonts/OFL.txt"))).toBe(true);
    expect(OG_SIZE).toEqual({ width: 1200, height: 630 });
  });

  it("цвета берутся из токенов тёмной темы", () => {
    const css = readFileSync(join(process.cwd(), "theme/tokens.css"), "utf8");
    expect(tokenColor(css, ".dark", "color-background").toLowerCase()).toBe("#171719");
    expect(tokenColor(css, ".dark", "color-accent")).toMatch(/^#[0-9a-f]{6}$/i);
    expect(tokenColor(css, ":root", "color-accent")).not.toBe(tokenColor(css, ".dark", "color-accent"));
  });

  it("нет токена — ошибка, а не чужой цвет", () => {
    expect(() => tokenColor(":root { --color-x: #fff; }", ":root", "color-y")).toThrow(/color-y/);
    expect(() => tokenColor(":root { --color-x: #fff; }", ".dark", "color-x")).toThrow(/\.dark/);
  });
});
