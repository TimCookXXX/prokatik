"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useSignOut } from "@/components/auth/useSignOut";
import {
  Package, Settings, ShieldCheck, LogOut, Palette,
  MessageCircle, Bell, type LucideIcon,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Brackets } from "@/components/brand/Brackets";
import { Avatar } from "@/components/ui/Avatar";
import { LiveDot, LiveCount, type LiveScope } from "@/components/realtime/LiveDot";
import { ThemeSegmented } from "@/components/providers/ThemeSegmented";
import { content } from "@theme/content";
import { WEBVISOR_PRIVATE } from "@/components/analytics/webvisor";

type Props = {
  email: string | null;
  name: string | null;
  image: string | null;
  isAdmin?: boolean;
};

// Курсор успевает пройти зазор между аватаром и меню — закрываем с задержкой.
const CLOSE_DELAY_MS = 160;

// Иконки нейтральные: скобки остаются пиктограммой только в таб-баре, чтобы
// бренд не спорил с навигацией.
// counter — какое число из стора показать рядом. Пункты с индикатором обязаны
// покрывать всё, от чего загорается точка на аватарке: иначе она горит, человек
// открывает меню, а там пусто — и идёт искать причину по разделам руками.
// «Заявки» — один пункт на обе роли, и счётчик у него тоже общий: other как раз
// и есть incoming + mine. Раздельные пункты заставляли выбирать роль до того,
// как человек увидел, что случилось.
export const LINKS = [
  { href: "/chat", label: "Сообщения", Icon: MessageCircle, counter: "messages" },
  { href: "/cabinet/requests", label: "Заявки", Icon: Bell, counter: "other" },
  { href: "/cabinet/listings", label: "Мои объявления", Icon: Package },
  { href: "/profile", label: "Настройки", Icon: Settings },
] as const satisfies readonly {
  href: string; label: string; Icon: LucideIcon; counter?: LiveScope;
}[];

export function UserMenu({ email, name, image, isAdmin = false }: Props) {
  // Общий хук, а не свой signOut: выход обязан ещё и забыть выбранный город,
  // иначе следующий человек за этим браузером получит чужой. Меню в шапке —
  // основной способ выйти на десктопе, и своя копия логики здесь означала бы,
  // что починка мимо него и проходит. Pending так же держится до редиректа.
  const { pending: isSigningOut, run: runSignOut } = useSignOut();

  // Меню раскрывается наведением, а сам аватар — ссылка в кабинет. Поэтому
  // состояние ведём вручную: штатный триггер Radix открывался бы по клику и
  // перехватывал переход.
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openNow = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const closeSoon = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };

  return (
    // modal=false: dropdown не должен включать react-remove-scroll. Иначе Radix
    // добавляет padding-right на <body> для компенсации скроллбара, и хедер
    // прыгает (вдвойне — с нашим scrollbar-gutter: stable место уже занято).
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Link
          href={"/cabinet" as never}
          aria-label="Кабинет"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full focus:[outline:none] focus:ring-2 focus:ring-ring"
          onMouseEnter={openNow}
          onMouseLeave={closeSoon}
          // Radix открывает меню по pointerdown — гасим, иначе клик по аватару
          // раскрывал бы список вместо перехода в кабинет.
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => setOpen(false)}
        >
          <span className="relative inline-flex">
            <Avatar src={image} name={name} size={32} />
            <LiveDot />
          </span>
        </Link>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        // Имя и почта владельца аккаунта — не для записей Вебвизора.
        className={`min-w-[220px] ${WEBVISOR_PRIVATE}`}
        onMouseEnter={openNow}
        onMouseLeave={closeSoon}
        // Radix при закрытии возвращает фокус на триггер. Для меню по наведению
        // это лишнее: фокус на аватаре снова открывал бы список, а курсора там
        // уже нет — и закрыть его было бы нечем.
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DropdownMenuItem asChild className="gap-2.5 px-2 py-2">
          <Link href={"/cabinet" as never}>
            <Avatar src={image} name={name} size={32} />
            <span className="min-w-0">
              <span className="block truncate font-medium">{name ?? "Без имени"}</span>
              {email && <span className="block truncate text-xs text-muted-foreground">{email}</span>}
            </span>
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {LINKS.map((item) => (
          <DropdownMenuItem key={item.href} asChild className="gap-2.5">
            <Link href={item.href as never}>
              <span className="flex w-6 shrink-0 justify-center">
                <item.Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              </span>
              {item.label}
              {"counter" in item && <LiveCount scope={item.counter} />}
            </Link>
          </DropdownMenuItem>
        ))}

        {isAdmin && (
          <DropdownMenuItem asChild className="gap-2.5">
            <Link href={"/admin" as never}>
              <span className="flex w-6 shrink-0 justify-center">
                <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              </span>
              Админка
            </Link>
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        <div className="flex items-center justify-between gap-3 px-2 py-1.5 text-sm">
          <span className="flex items-center gap-2.5">
            <span className="flex w-6 shrink-0 justify-center">
              <Palette className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </span>
            Тема
          </span>
          <ThemeSegmented />
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          className="gap-2.5"
          disabled={isSigningOut}
          onSelect={(e) => {
            // preventDefault — иначе Radix закроет меню сразу, вместе с лоадером.
            e.preventDefault();
            runSignOut();
          }}
        >
          <span className="flex w-6 shrink-0 justify-center">
            {isSigningOut ? (
              <Brackets size={12} running className="text-current" />
            ) : (
              <LogOut className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            )}
          </span>
          {isSigningOut ? "Выходим…" : content.auth.signOut}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
