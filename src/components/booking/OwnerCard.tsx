import Link from "next/link";
import { BadgeCheck, MapPin, CalendarClock, Navigation } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/button";
import { LoginTrigger } from "@/components/auth/LoginTrigger";
import { formatMonthYearGen } from "@/lib/catalog/dates";
import { DISTANCE_TITLE, distanceLabel } from "@/lib/geo/distance";
import type { GeoPrecision } from "@/lib/geo/precision";
import type { ListingDistance } from "@/server/catalog";

// Блок продавца под фото одной строкой: аватар, имя-ссылка с бейджем проверки,
// под ними справка (локация, на сайте с) мелким кеглем, справа — действия.
//
// Карты-заглушки тут больше нет. Она занимала 280×220 ради серой сетки и
// названия города, которое и так стоит строкой левее; интеграции карт нет, и
// пустая рамка только отодвигала описание вниз.
/* Подпись адреса с точкой (house, street, place) уже называет свой пункт —
 * «улица Базовская, Яблоновский», «Мега, Новая Адыгея» — и показывается как
 * есть: город каталога после неё читался бы так, будто Новая Адыгея — в
 * Краснодаре. Город дописывается только к подписи без точки (`city`: текст в
 * городе без геоданных или строка до backfill), и то если она не сам город. */
function placeLine(location: string | null | undefined, precision: GeoPrecision, cityName: string): string {
  const label = location?.trim();
  if (!label) return cityName;
  if (precision !== "city" || label.toLowerCase() === cityName.toLowerCase()) return label;
  return `${label}, ${cityName}`;
}

export function OwnerCard({
  name, href, image, isVerified, location, geoPrecision, cityName, distance = null, createdAt,
  chatHref, isAuthed, isOwn, authProps,
}: {
  name: string;
  href: string;
  image: string | null;
  isVerified: boolean;
  /**
   * Публичная подпись адреса (listings.location): улица, ЖК или пункт — без
   * номера дома. Полный адрес и точка сюда не приходят вовсе.
   */
  location?: string | null;
  /** Точность адреса (listings.geo_precision): у `city` подпись без пункта, к ней дописывается город. */
  geoPrecision: GeoPrecision;
  cityName: string;
  /** Расстояние от точки «Где» из адреса страницы; null — точки нет. */
  distance?: ListingDistance | null;
  createdAt: Date;
  /** Переписка по этому объявлению: существующая откроется, новая заведётся. */
  chatHref: string;
  isAuthed: boolean;
  /** Своё объявление — писать некому. */
  isOwn: boolean;
  // Анониму «Написать» открывает модалку входа, а не отдаёт его middleware:
  // редирект на /login даёт вспышку интерфейса. Так же сделано у «Сдать».
  authProps: { nextAuthProviders: string[]; vkEnabled: boolean; canRegisterByEmail: boolean };
}) {
  return (
    <div className="surface flex flex-wrap items-center gap-4 p-4 sm:p-5">
      <Avatar src={image} name={name} size={56} />

      {/* Ломается по ширине КАРТОЧКИ, а не окна: в колонке товара она узкая и на
        * широком экране (на md левая колонка — около 350px). basis-[220px]
        * задаёт порог: не влезли аватар, справка и кнопки в одну строку —
        * кнопки уезжают вниз. grow-[999] против grow у кнопок: свободное место
        * на общей строке забирает справка, кнопки остаются по содержимому. */}
      <div className="min-w-0 grow-[999] basis-[220px]">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-display text-lg font-bold leading-snug">
          {/* Охра — только под курсором: в покое имя читается как заголовок
            * блока, а не как акцент, спорящий с ценой и кнопкой брони. */}
          <Link href={href as never} className="hover:text-accent hover:underline">
            {name}
          </Link>
          {/* Бейдж тот же, что у заголовка профиля продавца, на ступень мельче:
            * рядом с именем в 17px плашка в text-sm была бы выше строки. */}
          {isVerified && (
            <span className="inline-flex items-center gap-1 rounded-sm bg-accent/15 px-2.5 py-0.5 text-xs font-medium text-accent">
              <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Проверен
            </span>
          )}
        </div>

        {/* Пункты разделяют иконки, а не точки: при переносе на узкой карточке
          * точка повисала в конце строки. */}
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {placeLine(location, geoPrecision, cityName)}
          </span>
          {distance && (
            <span title={DISTANCE_TITLE} className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <Navigation className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {distanceLabel(distance.km, distance.approx)}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            На сайте с {formatMonthYearGen(createdAt)}
          </span>
        </div>
      </div>

      {/* grow работает только когда кнопки остались на строке одни: тогда они
        * растягивают её на всю ширину и делят пополам. На общей строке со
        * справкой её grow-[999] не оставляет им свободного места. */}
      <div className="flex grow gap-2">
        {!isOwn && (isAuthed ? (
          <Button asChild className="h-11 flex-1">
            <Link href={chatHref as never}>Написать</Link>
          </Button>
        ) : (
          <LoginTrigger
            {...authProps}
            redirectTo={chatHref}
            className="inline-flex h-11 flex-1 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Написать
          </LoginTrigger>
        ))}
        <Button
          asChild
          variant="outline"
          className="h-11 flex-1 border-primary bg-transparent text-primary hoverable hover:text-primary"
        >
          <Link href={href as never}>Профиль</Link>
        </Button>
      </div>
    </div>
  );
}
