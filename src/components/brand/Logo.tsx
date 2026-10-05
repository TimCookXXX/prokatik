import { cn } from "@/lib/utils";

/* Знак inrenta: слово между двумя нарисованными скобками. Скобки — не глиф
 * шрифта, а два бокса с бордером, поэтому пропорции жёстко привязаны к кеглю:
 * толщина 0,08 · высота 0,95 · вылет 0,26 · зазор 0,14 от размера. Ниже 14 px
 * толщина фиксируется на 1,5 px, а зазор растёт — иначе знак слипается.
 *
 * Скобки охряные (--color-accent): по закону цвета они держат предмет, а не
 * зовут нажать. Переопределяются там, где знак работает иконкой навигации. */

/** Размеры знака от кегля — одни на шапку и на картинку для соцсетей
 *  (src/app/opengraph-image.tsx), чтобы знак не разъехался между ними. */
export function logoMetrics(size: number) {
  return {
    stroke: Math.max(1.5, +(size * 0.08).toFixed(2)),
    height: Math.round(size * 0.95),
    flare: Math.max(4, Math.round(size * 0.26)),
    gap: Math.round(size * (size < 14 ? 0.18 : 0.14)),
    /** Трекинг слова в em. */
    tracking: size >= 40 ? -0.035 : size >= 24 ? -0.03 : -0.02,
  };
}

export function Logo({
  size = 20,
  word = "inrenta",
  showWord = true,
  className,
  bracketClassName = "border-accent",
}: {
  size?: number;
  word?: string;
  showWord?: boolean;
  className?: string;
  /** Цвет скобок. Переопределяется там, где скобки работают иконкой и должны
   *  гаснуть вместе с остальной навигацией (таб-бар). */
  bracketClassName?: string;
}) {
  const { stroke, height, flare, gap, tracking: trackingEm } = logoMetrics(size);
  const tracking = `${trackingEm}em`;

  const bracket = (side: "left" | "right") => (
    <span
      aria-hidden="true"
      className={cn(
        "block shrink-0 transition-transform duration-200 ease-out",
        side === "left" ? "logo-brk-l" : "logo-brk-r",
        bracketClassName,
      )}
      style={{
        width: flare,
        height,
        borderWidth: stroke,
        [side === "left" ? "borderRightWidth" : "borderLeftWidth"]: 0,
      }}
    />
  );

  return (
    <span
      className={cn("inline-flex items-center leading-none", className)}
      // Ход скобок под курсором — от кегля: знак 20 px разводит на 2 px.
      style={{ gap, ["--logo-shift" as string]: `${Math.max(1.5, size * 0.1).toFixed(1)}px` }}
      aria-label={word}
    >
      {bracket("left")}
      {showWord && (
        <span
          className="font-mark font-bold"
          style={{ fontSize: size, lineHeight: 1, letterSpacing: tracking }}
        >
          {word}
        </span>
      )}
      {bracket("right")}
    </span>
  );
}
