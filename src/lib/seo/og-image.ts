// Картинка сайта для соцсетей и мессенджеров (src/app/opengraph-image.tsx).
// Здесь — то, что от рендера не зависит: размер и цвета из токенов.

/** Размер, который крупно показывают и Telegram, и VK, и Facebook. */
export const OG_SIZE = { width: 1200, height: 630 } as const;

/**
 * Цвет токена из theme/tokens.css. В картинку CSS-переменную не подставить,
 * поэтому значение читается из того же файла при сборке, а не дублируется:
 * смена палитры перекрасит и картинку. Нет токена или он не hex — ошибка
 * сборки, а не молча чужой цвет.
 */
export function tokenColor(css: string, scope: ":root" | ".dark", name: string): string {
  const escaped = scope.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1];
  if (!block) throw new Error(`tokens.css: нет блока ${scope}`);
  const value = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})\\b`).exec(block)?.[1];
  if (!value) throw new Error(`tokens.css: в ${scope} нет hex-значения --${name}`);
  return value;
}
