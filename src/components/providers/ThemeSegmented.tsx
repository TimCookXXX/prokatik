"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "light", label: "Светлая", Icon: Sun },
  { value: "dark", label: "Тёмная", Icon: Moon },
] as const;

/* Выбор темы одной строкой: две иконки в пилюле, под выбранной ездит подложка.
 *
 * Ориентируемся на resolvedTheme, а не на theme: пока стоит системная, выбор
 * ещё не сделан, но показать надо ту тему, которая реально применена.
 *
 * next-themes знает тему только на клиенте, поэтому до монтирования подложку не
 * рисуем — иначе разметка сервера и клиента разойдутся. */
export function ThemeSegmented() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const current = mounted ? resolvedTheme : undefined;
  const index = OPTIONS.findIndex((o) => o.value === current);

  return (
    <div
      role="radiogroup"
      aria-label="Тема"
      className="relative flex shrink-0 rounded-sm border border-border bg-background p-0.5"
    >
      {index >= 0 && (
        <span
          aria-hidden="true"
          className="absolute inset-y-0.5 left-0.5 w-7 rounded-sm bg-card shadow-sm transition-transform duration-200 ease-out [@media(pointer:coarse)]:w-11"
          style={{ transform: `translateX(${index * 100}%)` }}
        />
      )}

      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={current === value}
          aria-label={label}
          title={label}
          onClick={() => setTheme(value)}
          className={cn(
            // На тач-экране — в рост пальца: две кнопки вплотную, невидимо
            // расширить зону нельзя. Плашка выбранного едет на свою ширину
            // (translateX в процентах) и поэтому совпадает с кнопкой в обоих
            // размерах.
            "relative z-10 flex h-7 w-7 items-center justify-center rounded-sm transition-colors [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11",
            current === value ? "text-accent" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
