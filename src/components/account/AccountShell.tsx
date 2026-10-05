"use client";

// Каркас личных зон (кабинет, админка). С identity зона открывается
// «шапкой-героем»: обложка профиля уезжает под стеклянный хедер, на неё
// наезжает аватар, рядом имя, статус и метрики. Ниже — сетка: слева сайдбар
// с навигацией, справа содержимое. На мобайле /cabinet — хаб-оглавление, а в
// подразделах у заголовка появляется кнопка назад. Без identity (админка)
// остаётся старая раскладка: лента разделов на мобайле, сайдбар на десктопе.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronLeft, Bell, Package, User, LogOut, Zap,
  MessageCircle,
} from "lucide-react";
import { Brackets } from "@/components/brand/Brackets";
import { useSignOut } from "@/components/auth/useSignOut";
import { ProfileCover } from "@/components/account/ProfileCover";
import { AccountHero } from "@/components/account/AccountHero";
import { CabinetHub } from "@/components/account/CabinetHub";
import type { AccountNavGroup, AccountNavIcon } from "@/components/account/accountNav";
import { ACCOUNT_COVER_HEIGHT, type AccountIdentity } from "@/components/account/identity";
import { badgeCount } from "@/lib/badge-count";
import { useRealtime } from "@/components/realtime/context";
import type { Counters } from "@/components/realtime/store";

const ICONS: Record<AccountNavIcon, typeof User> = {
  summary: Zap,
  messages: MessageCircle,
  inbox: Bell,
  listings: Package,
  profile: User,
};

export type { AccountNavGroup, AccountNavItem } from "@/components/account/accountNav";
export type { AccountIdentity } from "@/components/account/identity";

function isActive(pathname: string, item: { href: string; exact?: boolean }): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function Badge({ n }: { n?: number }) {
  const badge = badgeCount(n);
  if (!badge) return null;
  return (
    <span className="ml-auto flex h-[18px] min-w-[18px] items-center justify-center rounded-pill bg-accent px-1.5 text-2xs font-bold text-accent-foreground">
      <span aria-hidden="true">{badge.display}</span>
      {/* Голое число рядом с названием раздела вслух звучит как часть названия.
          И при «99+» точный счёт иначе теряется совсем. */}
      <span className="sr-only">, {badge.label}</span>
    </span>
  );
}

// Какому пункту какой счётчик из стора. По ключу иконки искать нельзя — это
// ровно та эвристика, из-за которой «ждут ответа» в герое привязан к "inbox".
//
// Только сообщения. Бейдж «Заявок» считает ДРУГОЕ — сколько заявок ждёт МОЕГО
// ответа, а не сколько событий не увидено; подменять его числом из стора
// значило бы тихо поменять смысл. Тем более что лента теперь показывает обе
// роли, а «ждут ответа» в герое — по-прежнему только про мои решения. Живым его держит дебаунсенный refresh,
// который на кабинетных маршрутах и так срабатывает.
const LIVE_COUNTERS: Record<string, keyof Counters> = {
  "/chat": "messages",
};

export function AccountShell({
  groups, identity, children,
}: {
  groups: AccountNavGroup[];
  identity?: AccountIdentity | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "";
  const router = useRouter();

  // Стор, пока он есть; серверный проп, когда его нет. Числа подставляются
  // здесь, при сборке groups, а НЕ внутри бейджа: то же число читают
  // pendingCount, герой и мобильный хаб, и подстановка на уровне бейджа
  // оставила бы им серверное значение.
  //
  // counters === null означает «неизвестно»: соединения нет либо оно только что
  // оборвалось. Без возврата к пропу умерший realtime заморозил бы бейдж на
  // последнем известном числе, и это было бы хуже сегодняшнего поведения.
  const live = useRealtime((s) => s.counters);
  const groupsWithLive = live
    ? groups.map((g) => ({
      ...g,
      items: g.items.map((it) => {
        const key = LIVE_COUNTERS[it.href];
        return key ? { ...it, badge: live[key] } : it;
      }),
    }))
    : groups;

  const flat = groupsWithLive.flatMap((g) => g.items);
  // Заголовок — это раздел, в котором стоишь. Отдельное слово «Кабинет» ничего
  // не добавляло: и так видно, где ты, по подсвеченному пункту сайдбара.
  const currentItem = flat.find((it) => isActive(pathname, it));
  const CurrentIcon = currentItem?.icon ? ICONS[currentItem.icon] : null;
  const signOut = useSignOut();

  // «Ждут ответа» в герое — тот же счётчик, что и бейдж на входящих заявках:
  // источник один, второй раз в БД не ходим.
  const pendingCount = flat.find((it) => it.icon === "inbox")?.badge ?? 0;
  // Мобильный хаб живёт только на «Сводке»; в подразделах — кнопка назад.
  const isHub = identity != null && pathname === "/cabinet";
  // На мобильной переписке заголовок раздела скрыт: экран занимает вьюпорт
  // целиком, а путь к списку даёт кнопка «назад» в шапке переписки. На десктопе
  // заголовок остаётся — там список виден слева и без него.
  const isThread = /^\/chat\/.+/.test(pathname);
  const isChatList = pathname === "/chat";
  // Раздел переписок на мобайле идёт во весь экран, без отступов контейнера.
  const isChat = isChatList || isThread;

  return (
    <div data-account-shell>
      {/* Обложка на всю ширину, уезжает под плавающую панель хедера (она sticky
        * и остаётся сверху) — тем же приёмом, что герой главной. На мобайле
        * показывается только на хабе — в подразделах ей делать нечего.
        *
        * Кнопки «Сменить обложку» на фото нет: тот же выбор лежит на экране
        * настроек профиля (ProfileCoverField), и второй вход в него занимал
        * угол обложки на каждой странице личной зоны. */}
      {identity && (
        <ProfileCover
          src={identity.coverUrl}
          className={`${ACCOUNT_COVER_HEIGHT} -mt-[var(--header-total)] ${isHub ? "" : "max-md:hidden"}`}
        />
      )}

      <div className={`mx-auto w-full max-w-[1200px] px-4 pb-6 ${identity ? "" : "pt-6"} ${identity && !isHub && !isChat ? "max-md:pt-3" : ""} ${isChat ? "max-md:pb-0" : ""}`}>
        {/* editable — это своя личная зона, поэтому аватарку здесь можно и
          * открыть, и сменить. Тот же герой в превью выбора обложки рисуется
          * без этого флага. */}
        {identity && <AccountHero me={identity} pendingCount={pendingCount} editable />}
        {identity && isHub && (
          <CabinetHub me={identity} groups={groupsWithLive} icons={ICONS} signOut={signOut} editable />
        )}

        {/* Без identity (админка) разделы на мобайле по-прежнему едут лентой. */}
        {!identity && (
          <nav
            aria-label="Разделы"
            className="-mx-4 mb-4 flex items-stretch gap-1 overflow-x-auto px-4 md:hidden"
          >
            {flat.map((it) => (
              <Link
                key={it.href}
                href={it.href as never}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-sm px-3 py-2 text-sm ${
                  isActive(pathname, it)
                    ? "bg-selected font-medium text-selected-foreground"
                    : "text-muted-foreground"
                }`}
              >
                {it.icon && (() => {
                  const Icon = ICONS[it.icon];
                  return <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />;
                })()}
                {it.label}
                <Badge n={it.badge} />
              </Link>
            ))}
          </nav>
        )}

        <div className={`md:grid md:grid-cols-[250px_1fr] md:items-start md:gap-5 ${identity ? "md:mt-3" : ""}`}>
          <aside className="hidden md:sticky md:top-20 md:flex md:flex-col md:gap-3.5">
            <nav aria-label="Разделы" className="surface flex flex-col gap-0.5 p-2">
              {groupsWithLive.map((group, gi) => (
                /* Заголовка может не быть: кабинет — плоский список, группы
                 * остались только у админки. Ключ по индексу, потому что
                 * заголовок перестал быть обязательным и уникальным. */
                <div key={group.title ?? gi} className="flex flex-col gap-0.5">
                  {group.title && (
                    <span className="px-3 pb-1 pt-2.5 font-mono text-2xs uppercase tracking-mono text-muted-foreground">
                      {group.title}
                    </span>
                  )}
                  {group.items.map((it) => {
                    const active = isActive(pathname, it);
                    const Icon = it.icon ? ICONS[it.icon] : null;
                    return (
                      <Link
                        key={it.href}
                        href={it.href as never}
                        className={`flex items-center gap-2.5 rounded-sm px-3 py-2 text-sm transition-colors ${
                          active
                            ? "bg-selected font-medium text-selected-foreground"
                            : "text-muted-foreground hoverable hover:text-foreground"
                        }`}
                      >
                        {Icon && (
                          <Icon
                            className={`h-4 w-4 shrink-0 ${active ? "text-accent" : ""}`}
                            aria-hidden="true"
                          />
                        )}
                        <span className="min-w-0 flex-1 truncate">{it.label}</span>
                        <Badge n={it.badge} />
                      </Link>
                    );
                  })}
                </div>
              ))}

              {identity && (
                <button
                  type="button"
                  disabled={signOut.pending}
                  onClick={signOut.run}
                  className="flex items-center gap-2.5 rounded-sm px-3 py-2 text-left text-sm text-muted-foreground transition-colors hoverable hover:text-foreground disabled:opacity-60"
                >
                  <span className="flex w-4 shrink-0 justify-center">
                    {signOut.pending
                      ? <Brackets size={12} running className="text-current" />
                      : <LogOut className="h-4 w-4" aria-hidden="true" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {signOut.pending ? "Выходим…" : "Выйти"}
                  </span>
                </button>
              )}
            </nav>
          </aside>

          <div className="min-w-0">
            {currentItem && (
              /* На десктопе заголовок скрыт визуально, но остаётся в разметке
               * (md:sr-only): раздел и так назван подсвеченным пунктом сайдбара,
               * а страница без единственного h1 — это дыра для скринридера.
               * На мобайле он виден: сайдбара там нет, и в нём же живёт кнопка
               * «назад» — единственный путь из подраздела.
               *
               * В чате он sr-only на обеих ширинах: панель раздела там fixed и
               * перекрывает поток, поэтому видимый заголовок с кнопкой «назад»
               * рисуют сами экраны чата. */
              <h1 className={`mb-3 flex items-center gap-2.5 font-display text-2xl font-bold ${isChat ? "sr-only" : "md:sr-only"} ${identity ? "max-md:mt-4" : ""} ${isHub ? "max-md:mt-6" : ""}`}>
                {/* Ленты табов на мобайле больше нет — назад ведёт кнопка у
                  * заголовка: обычно туда, откуда пришли, а без истории (по
                  * прямой ссылке) — в кабинет. На хабе и десктопе её нет.
                  *
                  * Список переписок — исключение: оттуда всегда в кабинет, без
                  * оглядки на историю. Иначе получается качели. Из переписки
                  * назад ведёт в список, значит запись перед списком в истории
                  * — почти всегда другая переписка, и «назад» со списка кидало
                  * бы обратно в чат, из которого только что вышли. */}
                {identity && !isHub && (
                  <button
                    type="button"
                    onClick={() => {
                      if (isChatList) router.push("/cabinet" as never);
                      else if (window.history.length > 1) router.back();
                      else router.push("/cabinet" as never);
                    }}
                    aria-label="Назад"
                    className="tap-target flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground md:hidden"
                  >
                    <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                  </button>
                )}
                {CurrentIcon && (
                  <CurrentIcon className="h-6 w-6 shrink-0 text-accent" aria-hidden="true" />
                )}
                {currentItem.label}
              </h1>
            )}
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
