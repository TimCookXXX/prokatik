import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import PrivateAreaLayout from "@/app/(app)/layout";
import AuthAreaLayout from "@/app/(auth)/layout";

// Страховка от регрессии приватности: личные разделы всегда под обёрткой,
// которую Вебвизор не записывает (docs/seo.md, «Аналитика»).
describe("личные разделы скрыты от Вебвизора", () => {
  it.each([
    ["(app)", PrivateAreaLayout],
    ["(auth)", AuthAreaLayout],
  ])("%s оборачивает страницы в ym-hide-content", (_name, Layout) => {
    const html = renderToString(<Layout><p>секрет</p></Layout>);
    expect(html).toMatch(/class="[^"]*ym-hide-content[^"]*"/);
    expect(html).toContain("секрет");
  });
});
