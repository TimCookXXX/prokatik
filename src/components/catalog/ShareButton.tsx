"use client";

// «Поделиться» на карточке объявления.
//
// Телефон с Web Share — системный лист: там все мессенджеры человека, и меню
// поверх него было бы лишним шагом. Десктоп и браузер без Web Share — маленькое
// меню: скопировать ссылку, Telegram, WhatsApp, ВКонтакте. На десктопе лист
// есть не везде, а где есть (Safari, Chrome под Windows), он беднее меню.
//
// Делится всегда канонический адрес — страница передаёт его готовым, без
// дат, количества и точки «Где»: выбор в виджете брони личный.
//
// Меню одно на оба режима. На телефоне его открытие перехватывается, и вместо
// него зовётся лист; не открылся лист (запрет браузера, а не отмена
// человеком) — открывается то же меню.

import * as React from "react";
import { Link2, Share2 } from "lucide-react";
import { SiTelegram, SiVk, SiWhatsapp } from "react-icons/si";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { shareLinks } from "@/lib/share";
import { cn } from "@/lib/utils";
import { content } from "@theme/content";

// Основной ввод — палец. Ширина экрана тут не годится: планшет с мышью широк,
// а системный лист ему всё равно привычнее.
const TOUCH = "(hover: none) and (pointer: coarse)";

function canNativeShare(): boolean {
  return typeof navigator !== "undefined"
    && typeof navigator.share === "function"
    && typeof window.matchMedia === "function"
    && window.matchMedia(TOUCH).matches;
}

/** Режим с сервера — меню: на сервере ни navigator, ни экрана нет. */
function useNativeShare(): boolean {
  const subscribe = React.useCallback((cb: () => void) => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
    const mq = window.matchMedia(TOUCH);
    mq.addEventListener("change", cb);
    return () => mq.removeEventListener("change", cb);
  }, []);
  return React.useSyncExternalStore(subscribe, canNativeShare, () => false);
}

const itemIcon = "mr-2.5 h-4 w-4 shrink-0 text-muted-foreground";
// Меню бывает и под пальцем (браузер без Web Share): там пункт — не ниже 44 px.
const item = "[@media(pointer:coarse)]:min-h-11";

/**
 * Запасное копирование — когда Clipboard API нет (небезопасный контекст,
 * встроенный браузер) или он отказал. Без него человеку оставалась бы строка
 * браузера, а в ней адрес с датами и точкой «Где».
 */
function legacyCopy(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  try {
    area.focus({ preventScroll: true });
    area.select();
    return typeof document.execCommand === "function" && document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

export function ShareButton({
  url, title, text, className,
}: {
  /** Абсолютный канонический адрес объявления. */
  url: string;
  title: string;
  /** Подпись к ссылке: название, город, цена. */
  text: string;
  className?: string;
}) {
  const native = useNativeShare();
  const [open, setOpen] = React.useState(false);
  const t = content.share;
  const links = shareLinks(url, text);

  async function nativeShare() {
    try {
      await navigator.share({ title, text, url });
    } catch (e) {
      // Закрыть лист — не ошибка. Остальное (браузер не дал открыть) уводит
      // в меню, чтобы кнопка не молчала.
      if ((e as { name?: string } | null)?.name === "AbortError") return;
      setOpen(true);
    }
  }

  async function copy() {
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        ok = true;
      }
    } catch {
      // Отказ буфера — пробуем запасной путь ниже.
    }
    if (!ok) ok = legacyCopy(url);
    if (ok) toast.success(t.copied);
    else toast.error(t.copyFailed);
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-share-trigger=""
          // Под пальцем — 44 px, как у остальных кнопок касания; с мышью —
          // компактные 36 px рядом с заголовком.
          className={cn(
            "h-11 w-11 shrink-0 gap-2 px-0 sm:w-auto sm:px-3",
            "[@media(pointer:fine)]:h-9 max-sm:[@media(pointer:fine)]:w-9",
            className,
          )}
          // Телефон: меню не открывается, вместо него — лист. Радикс открывает
          // меню на pointerdown, а лист можно звать только из click (pointerdown
          // пальца не даёт браузеру «жеста пользователя»), поэтому pointerdown
          // гасится, а лист зовёт click.
          onPointerDown={(e) => { if (native) e.preventDefault(); }}
          onKeyDown={(e) => {
            if (native && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              void nativeShare();
            }
          }}
          onClick={() => { if (native) void nativeShare(); }}
        >
          <Share2 className="h-4 w-4" aria-hidden="true" />
          {/* Подпись видна с sm; уже — только для чтения с экрана. */}
          <span className="sr-only sm:not-sr-only">{t.button}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[13rem]">
        <DropdownMenuItem className={item} onSelect={() => void copy()}>
          <Link2 className={itemIcon} aria-hidden="true" />
          {t.copy}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className={item}>
          <a href={links.telegram} target="_blank" rel="noopener noreferrer">
            <SiTelegram className={itemIcon} aria-hidden="true" />
            {t.telegram}
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className={item}>
          <a href={links.whatsapp} target="_blank" rel="noopener noreferrer">
            <SiWhatsapp className={itemIcon} aria-hidden="true" />
            {t.whatsapp}
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className={item}>
          <a href={links.vk} target="_blank" rel="noopener noreferrer">
            <SiVk className={itemIcon} aria-hidden="true" />
            {t.vk}
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
