"use client";

// Колонка переписок: поиск, фильтры, список.
//
// Поиск и фильтры клиентские, поверх уже загруженных тредов. Ограничение:
// getThreadList отдаёт не больше 50 штук, пагинации у списка нет, значит и
// поиск накрывает только их. Чип «Непрочитанные» считает ТРЕДЫ, а бейдж в
// навигации кабинета — СООБЩЕНИЯ; это разные величины, и подписи их различают.

import { useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSelectedLayoutSegment } from "next/navigation";
import { Check, CheckCheck, Search } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { fieldWithin } from "@/components/ui/field";
import { ChatMobileHeader } from "@/components/chat/ChatMobileHeader";
import { filterThreads, type ThreadFilter } from "@/lib/chat/grouping";
import { content } from "@theme/content";
import type { ThreadListItem } from "@/server/chat";

const t = content.chat;

// Сегодняшнее — временем, остальное — датой. Обе ветки считаются в одном
// (локальном) поясе: сравнивать день по локальному времени, а печатать по UTC —
// значит показывать вечерние сообщения вчерашними.
function when(value: Date): string {
  const date = new Date(value);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

export function ThreadList({ threads }: { threads: ThreadListItem[] }) {
  const activeId = useSelectedLayoutSegment();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ThreadFilter>("all");

  const unreadThreads = useMemo(() => threads.filter((x) => x.unread > 0).length, [threads]);
  const visible = useMemo(
    () => filterThreads(threads, query, filter),
    [threads, query, filter],
  );

  const chip = (value: ThreadFilter, label: string) => (
    <button
      key={value}
      type="button"
      aria-pressed={filter === value}
      onClick={() => setFilter(value)}
      className={`shrink-0 rounded-sm border px-2.5 py-1 text-xs transition-colors ${
        filter === value
          // Выбранное среди плашек: заливки мало (1.16 против соседа), поэтому
          // кант. Текст обычный — охряный на плашке норму не берёт.
          ? "border-selected bg-selected text-foreground"
          : "border-transparent bg-muted text-muted-foreground hoverable hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );

  return (
    <>
      <ChatMobileHeader />

      {/* Шапка колонки вне <nav>: поиск и фильтры навигацией не являются. */}
      <div className="flex shrink-0 flex-col gap-2.5 border-b border-border p-3">
        <div className={`${fieldWithin} flex h-9 items-center gap-2 px-3`}>
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.searchPlaceholder}
            aria-label={t.searchPlaceholder}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {chip("all", t.filterAll)}
          {chip("unread", unreadThreads ? `${t.filterUnread} · ${unreadThreads}` : t.filterUnread)}
          {chip("mine", t.filterMine)}
        </div>
      </div>

      {visible.length === 0 ? (
        <p role="status" className="p-6 text-center text-sm text-muted-foreground">
          {t.nothingFound}
        </p>
      ) : (
        <nav
          aria-label="Переписки"
          tabIndex={0}
          className="min-h-0 flex-1 overflow-y-auto p-1.5 [overscroll-behavior:contain] max-md:pb-[var(--tabbar-h)]"
        >
          {visible.map((item) => (
            <ThreadRow key={item.id} item={item} active={item.id === activeId} />
          ))}
        </nav>
      )}
    </>
  );
}

function ThreadRow({ item, active }: { item: ThreadListItem; active: boolean }) {
  const name = item.counterpartName ?? "Собеседник";
  const StatusIcon = item.lastMessageReadByCounterpart ? CheckCheck : Check;

  return (
    <Link
      href={`/chat/${item.id}` as never}
      aria-current={active ? "page" : undefined}
      className={`relative flex gap-2.5 rounded-sm p-2.5 transition-colors ${
        active ? "bg-selected" : "hoverable"
      }`}
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute bottom-3 left-0 top-3 w-0.5 rounded-pill bg-accent"
        />
      )}
      <Avatar src={item.counterpartImage} name={name} size={44} />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className={`min-w-0 flex-1 truncate text-sm ${
              item.unread > 0 ? "font-semibold" : "font-medium"
            }`}
          >
            {name}
          </span>
          {/* Пояс читателя серверу неизвестен — гидратации это знать не нужно. */}
          <span suppressHydrationWarning className="shrink-0 text-2xs text-muted-foreground">
            {when(item.lastMessageAt)}
          </span>
        </div>

        <div className="mt-0.5 flex items-center gap-1.5">
          {item.listingImage && (
            <Image
              src={item.listingImage}
              alt=""
              width={14}
              height={14}
              className="h-3.5 w-3.5 shrink-0 rounded-sm object-cover"
            />
          )}
          <span className="min-w-0 truncate text-2xs text-muted-foreground">
            {item.listingTitle}
          </span>
        </div>

        <div className="mt-0.5 flex items-center gap-1.5">
          {item.lastMessageMine && (
            <>
              <StatusIcon
                className={`h-3.5 w-3.5 shrink-0 ${
                  item.lastMessageReadByCounterpart ? "text-primary" : "text-muted-foreground"
                }`}
                aria-hidden="true"
              />
              {/* Статус только иконкой — не статус: скринридеру нужно слово. */}
              <span className="sr-only">
                {item.lastMessageReadByCounterpart ? t.read : t.delivered}
              </span>
            </>
          )}
          <span
            className={`min-w-0 flex-1 truncate text-xs ${
              item.unread > 0 ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            {item.preview}
          </span>
          {item.unread > 0 && (
            <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-pill bg-accent px-1.5 text-2xs font-bold text-accent-foreground">
              {item.unread}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
