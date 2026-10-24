// Шапка переписки: собеседник и чип объявления.
//
// Имя ThreadTopBar, а не ThreadHeader: последнее занято типом в server/chat,
// и импортировать их вместе пришлось бы через переименование.

import Link from "next/link";
import Image from "next/image";
import { ChatPersonLink } from "@/components/chat/ChatPersonLink";
import { ThreadBackButton } from "@/components/chat/ThreadBackButton";
import { listingPath } from "@/lib/catalog/listing-path";
import { formatDeposit } from "@/lib/catalog/format";
import { formatUnitPriceSlash, primaryPrice } from "@/lib/catalog/tariff";
import { content } from "@theme/content";
import type { ThreadHeader } from "@/server/chat";

const t = content.chat;

// Главная цена вещи с единицей: «500 ₽/сутки» или «2 250 ₽/неделя».
function headerPrice(header: ThreadHeader): string {
  const p = primaryPrice({
    priceDay: header.listingPriceDay,
    priceWeek: header.listingPriceWeek,
    priceMonth: header.listingPriceMonth,
  });
  return p ? formatUnitPriceSlash(p) : "";
}

export function ThreadTopBar({ header }: { header: ThreadHeader }) {
  const name = header.counterpartName ?? "Собеседник";
  const href = listingPath(
    header.listingCitySlug,
    header.listingCategorySlug,
    header.listingSlug,
    header.listingId,
  );

  // Цена и залог собираются общими форматтерами: второй реализации денежного
  // формата в проекте быть не должно. Залог бывает трёх видов, не только суммой.
  const price = headerPrice(header);
  const deposit = formatDeposit(header.listingDepositType, header.listingDepositAmount);

  const chipInner = (
    <>
      {header.listingImage && (
        <Image
          src={header.listingImage}
          alt=""
          width={28}
          height={28}
          className="h-7 w-7 shrink-0 rounded-sm object-cover"
        />
      )}
      <span className="min-w-0">
        <span className="block max-w-[190px] truncate text-xs font-medium">
          {header.listingTitle}
        </span>
        <span className="block font-mark text-2xs text-muted-foreground">
          {[price, deposit].filter(Boolean).join(" · ")}
        </span>
      </span>
    </>
  );

  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-2.5 md:px-4">
      {/* Кнопка назад только на мобиле: там заголовок раздела скрыт, и другого
        * пути к списку нет. На десктопе список виден слева. */}
      <ThreadBackButton />

      <ChatPersonLink
        userId={header.counterpartId}
        name={name}
        image={header.counterpartImage}
        banned={header.counterpartBannedAt !== null}
      />

      {/* Снятое с публикации объявление отдаёт 404 — чип остаётся, ссылка нет. */}
      {header.listingStatus === "active" ? (
        <Link
          href={href as never}
          className="hidden items-center gap-2.5 rounded-sm bg-muted py-1.5 pl-1.5 pr-2.5 transition-colors hoverable sm:flex"
        >
          {chipInner}
        </Link>
      ) : (
        <span className="hidden items-center gap-2.5 rounded-sm bg-muted py-1.5 pl-1.5 pr-2.5 sm:flex">
          {chipInner}
        </span>
      )}
    </header>
  );
}

// Узкий экран: чип не влезает в шапку, поэтому объявление едет отдельной полосой.
export function ThreadListingBar({ header }: { header: ThreadHeader }) {
  const href = listingPath(
    header.listingCitySlug,
    header.listingCategorySlug,
    header.listingSlug,
    header.listingId,
  );

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted px-3 py-2 sm:hidden">
      {header.listingImage && (
        <Image
          src={header.listingImage}
          alt=""
          width={36}
          height={36}
          className="h-9 w-9 shrink-0 rounded-sm object-cover"
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{header.listingTitle}</p>
        <p className="font-mark text-2xs text-muted-foreground">
          {[
            headerPrice(header),
            formatDeposit(header.listingDepositType, header.listingDepositAmount),
          ].filter(Boolean).join(" · ")}
        </p>
      </div>
      {header.listingStatus === "active" && (
        <Link href={href as never} className="shrink-0 text-xs text-accent">
          {t.openListing}
        </Link>
      )}
    </div>
  );
}
