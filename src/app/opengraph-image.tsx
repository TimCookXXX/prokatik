// Картинка сайта по умолчанию для соцсетей и мессенджеров: знак [inrenta] как
// в шапке — охряные скобки и слово шрифтом знака — на фоне тёмной темы.
//
// Файловая конвенция Next: картинка рисуется на этапе сборки (данных запроса
// здесь нет) и отдаётся готовым PNG; og:image, размеры и тип Next ставит сам
// на всех страницах, у которых нет своего openGraph.images.
//
// Шрифт — локальный TTF из theme/brand/fonts: next/og читает только ttf, otf
// и woff, а next/font отдаёт woff2, так что взять шрифт шапки напрямую нельзя.
// Сборка в сеть за шрифтом не ходит. Цвета читаются из theme/tokens.css,
// пропорции знака — из той же функции, что у шапки.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { logoMetrics } from "@/components/brand/Logo";
import { OG_SIZE, tokenColor } from "@/lib/seo/og-image";
import { seo } from "@theme/seo";

export const alt = seo.defaultTitle;
export const size = OG_SIZE;
export const contentType = "image/png";

const [font, css] = await Promise.all([
  readFile(join(process.cwd(), "theme/brand/fonts/SpaceGrotesk-Bold.ttf")),
  readFile(join(process.cwd(), "theme/tokens.css"), "utf8"),
]);

// Кегль слова: знак занимает около половины ширины — крупно в превью
// мессенджера и не упирается в края, которые соцсети обрезают.
const MARK = 132;

export default function OpenGraphImage() {
  const background = tokenColor(css, ".dark", "color-background");
  const foreground = tokenColor(css, ".dark", "color-foreground");
  const accent = tokenColor(css, ".dark", "color-accent");
  const m = logoMetrics(MARK);

  const bracket = (side: "left" | "right") => {
    const line = `${m.stroke}px solid ${accent}`;
    return (
      <div
        style={{
          width: m.flare,
          height: m.height,
          borderTop: line,
          borderBottom: line,
          ...(side === "left" ? { borderLeft: line } : { borderRight: line }),
        }}
      />
    );
  };

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: m.gap }}>
          {bracket("left")}
          <div
            style={{
              fontFamily: "Space Grotesk",
              fontWeight: 700,
              fontSize: MARK,
              lineHeight: 1,
              letterSpacing: m.tracking * MARK,
              color: foreground,
            }}
          >
            {seo.siteName}
          </div>
          {bracket("right")}
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [{ name: "Space Grotesk", data: font, style: "normal", weight: 700 }],
    },
  );
}
