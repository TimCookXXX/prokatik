"use client";

// Точка брони на странице позиции: выбор дат/количества + кнопка.
// Выбор синхронизируется в URL query (history.replaceState, без перезагрузки),
// поэтому переживает OAuth-redirect: LoginDialog отправляет провайдеру
// callbackUrl = текущий path+query, и после входа пользователь возвращается
// на тот же шаг с теми же датами. В query меняются только from/to/qty: чужие
// параметры («Где», метки перехода) остаются и в адресе, и в callbackUrl.
//
// Кнопка ведёт в форму заявки (анонима — сперва в окно входа), а у владельца её
// нет вовсе: свою вещь бронировать нельзя, createBookingRequest отвечает
// own_listing.

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { LoginDialog } from "@/components/auth/LoginDialog";
import type { AuthPanelProps } from "@/lib/auth/panel-props";
import { BookingFormDialog } from "@/components/booking/BookingFormDialog";
import { BookingCalendar } from "@/components/booking/BookingCalendar";
import {
  buildBookingQuery, mergeBookingQuery, rentalDaysCount, type BookingSelection,
} from "@/lib/booking/params";
import { pickRange } from "@/lib/booking/range-pick";
import { unavailableDates, type DayLoad } from "@/lib/catalog/availability";
import { field } from "@/components/ui/field";
import { formatDayMonth } from "@/lib/catalog/dates";
import {
  depositValue, formatHandover, formatPrice, type DepositType,
} from "@/lib/catalog/format";
import { HandoverIcon } from "@/components/catalog/HandoverIcon";
import { content } from "@theme/content";

const t = content.booking;

export interface BookingWidgetProps {
  listingId: string;
  listingTitle: string;
  initialPhone: string;         // из профиля; пусто до первой заявки
  pathname: string;             // /kazan/elektroinstrument/perforator-bosch-{ULID}
  initial: BookingSelection;    // уже провалидировано сервером (parseBookingParams)
  today: string;
  maxDate: string;              // горизонт бронирования
  // Занятость по дням на весь горизонт (plain object: Map не проходит RSC-границу).
  availability: Record<string, DayLoad>;
  quantity: number;
  priceDay: number;
  /* Залог исходными данными, а не готовой строкой. Строкой он сюда и
   * приезжал — и разбирался обратно регуляркой, потому что плитке нужно
   * значение без слова «залог». Форматирование живёт в lib/catalog/format,
   * и обеим формам залога полагается один вход. */
  depositType: DepositType;
  depositAmount: number | null;
  // Флагами, а не готовой строкой: от них зависит ещё и иконка.
  handoverPickup: boolean;
  handoverDelivery: boolean;
  sellerName: string;
  sellerHref: string;
  isAuthed: boolean;
  /** Своё объявление — бронировать нечего. */
  isOwn: boolean;
  authProps: AuthPanelProps;
}

export function BookingWidget(props: BookingWidgetProps) {
  const [sel, setSel] = useState<BookingSelection>(props.initial);
  const [loginOpen, setLoginOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const setQty = (qty: number) => setSel((cur) => ({ ...cur, qty }));

  // from === "" → ничего не выбрано; from && to === "" → выбран только «Забрать»
  // (ждём «Вернуть»); from && to → полный диапазон.
  const hasComplete = Boolean(sel.from && sel.to);

  // Дефолтная дата ведёт себя как «Забрать»: первый клик расширяет её в диапазон.
  // Дальше — обычный цикл pickRange, общий с полем «Когда» в поиске:
  // клик → новый «Забрать», ещё клик → «Вернуть».
  const [touched, setTouched] = useState(false);
  const onDayPick = (day: string) => {
    setSel((cur) => {
      const next = pickRange(touched ? cur : { from: cur.from, to: null }, day);
      return { ...cur, from: next.from, to: next.to ?? "" };
    });
    if (!touched) setTouched(true);
  };

  // Адрес страницы с текущим выбором. Собирается из живого location.search, а
  // не с нуля: виджет не знает чужих параметров и не должен их стирать.
  const selectionHref = () => {
    const qs = mergeBookingQuery(window.location.search, hasComplete ? sel : null, props.today);
    return qs ? `${props.pathname}?${qs}` : props.pathname;
  };
  const selectionKey = hasComplete ? buildBookingQuery(sel, props.today) : "";
  // Свой стартовый выбор (первый свободный день, когда сегодня занято) виджет
  // в адрес не пишет: from/to адреса панель поиска показывает как даты
  // «Когда» и уносит в следующий поиск, а их никто не выбирал. Адрес меняется,
  // как только выбор сдвинулся, — или сразу, если даты в нём уже были (тогда
  // это их нормализация). До входа выбор доезжает через callbackUrl.
  // Зависимость — ключ выбора, а не sel: selectionHref читает sel, и ключ
  // описывает его целиком (дефолты опущены так же, как в адресе).
  const initialKey = useRef(selectionKey);
  const moved = useRef(false);
  useEffect(() => {
    if (selectionKey !== initialKey.current) moved.current = true;
    const query = new URLSearchParams(window.location.search);
    if (!moved.current && !query.has("from") && !query.has("to")) return;
    window.history.replaceState(null, "", selectionHref());
  }, [selectionKey]);

  // callbackUrl входа — снимок адреса в момент нажатия «Забронировать».
  const [callbackUrl, setCallbackUrl] = useState(props.pathname);

  const days = hasComplete ? rentalDaysCount(sel) : 0;
  const estimate = useMemo(() => {
    if (!hasComplete) return null;
    return props.priceDay * days * sel.qty;
  }, [props.priceDay, hasComplete, days, sel.qty]);

  // Дни выбранного диапазона, где не набирается qty свободных единиц.
  const conflicts = useMemo(() => {
    if (!hasComplete) return [];
    const map = new Map(Object.entries(props.availability));
    return unavailableDates(props.quantity, map, sel.from, sel.to, sel.qty);
  }, [props.availability, props.quantity, sel, hasComplete]);
  const hasConflict = conflicts.length > 0;
  const bookDisabled = !hasComplete || hasConflict;

  // Календарь занятости — на самой странице, в виджете. Кнопка полосы на мобиле
  // ведёт к нему, пока бронировать нечего: второй календарь в шторке спорил бы
  // с этим за выбор. scroll-mt у цели держит её под липкой шапкой.
  // Фокус переезжает следом: иначе он остаётся на кнопке внизу экрана, и с
  // клавиатуры или скринридера до календаря пришлось бы идти через всю
  // страницу. preventScroll — прокрутку уже ведёт scrollIntoView, плавно.
  const calendarRef = useRef<HTMLDivElement>(null);
  const toCalendar = () => {
    const el = calendarRef.current;
    if (!el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    el.focus({ preventScroll: true });
  };

  const onBook = () => {
    if (bookDisabled) return;
    if (props.isAuthed) {
      setFormOpen(true);
    } else {
      setCallbackUrl(selectionHref());
      setLoginOpen(true);
    }
  };

  // Место кнопки: владельцу мутация ответит own_listing, поэтому кнопки у него
  // нет вовсе — на её месте подпись, а не другое действие. Карточка своей вещи
  // показывает владельцу ровно то, что видит арендатор, а дела с объявлением
  // делаются в кабинете. Календарь занятости и цена остаются.
  const bookSlot = (extra: string) => (
    props.isOwn ? (
      <p className={`text-center text-sm text-muted-foreground ${extra}`}>
        Это ваше объявление
      </p>
    ) : (
      <Button className={extra} onClick={onBook} disabled={bookDisabled}>
        {hasComplete ? t.book : t.pickDates}
      </Button>
    )
  );

  // Кнопка полосы на мобиле не бывает мёртвой: календарь от неё далеко, и
  // серая «Выберите даты» внизу экрана не говорила, куда идти. Пока дат нет
  // или они заняты, она ведёт к календарю; бронирует — когда есть что.
  const barAction = !hasComplete
    ? <Button className="shrink-0" onClick={toCalendar}>{t.pickDates}</Button>
    : hasConflict
      ? <Button className="shrink-0" onClick={toCalendar}>{t.changeDates}</Button>
      : <Button className="shrink-0" onClick={onBook}>{t.book}</Button>;

  // Владельцу подсказка про занятые даты не адресована: выбирать ему нечего,
  // а занятость он и так видит в календаре выше.
  const conflictMessage = hasConflict && !props.isOwn ? (
    <p className="text-sm text-destructive" role="alert">
      {sel.qty > 1 ? `Нет ${sel.qty} свободных единиц` : "Занято"}:{" "}
      {conflicts.map(formatDayMonth).join(", ")}. Выберите другие даты
      {props.quantity > 1 && sel.qty > 1 ? " или меньшее количество" : ""}.
    </p>
  ) : null;

  const clearDates = () => {
    setSel((cur) => ({ ...cur, from: "", to: "" }));
    setTouched(true);
  };

  // Цена и залог — блоками внизу (как у Hygglo). Значения — уже строки.
  // Обе плитки безусловны: цена за сутки у объявления обязательна, а залог
  // «без залога» тоже показывается — это ответ на вопрос, а не его отсутствие.
  const priceBoxes: { value: string; label: string }[] = [
    { value: formatPrice(props.priceDay), label: "сутки" },
    { value: depositValue(props.depositType, props.depositAmount), label: "залог" },
  ];

  return (
    <>
      <div
        ref={calendarRef}
        tabIndex={-1}
        role="group"
        aria-label={t.calendar}
        className="surface scroll-mt-[calc(var(--header-total)+0.75rem)] p-4 focus-visible:[outline:none] focus-visible:ring-2 focus-visible:ring-ring sm:p-5"
      >
        <BookingCalendar
          from={sel.from}
          to={sel.to}
          onDayPick={onDayPick}
          today={props.today}
          maxDate={props.maxDate}
          availability={props.availability}
          quantity={props.quantity}
          qty={sel.qty}
        />

        {/* Забрать / Вернуть — как pickup/drop off у Hygglo. */}
        <div className="mt-3 grid grid-cols-2 gap-3 text-center">
          <div>
            <div className="text-xs text-muted-foreground">Забрать</div>
            <div className={`text-xs ${sel.from ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
              {sel.from ? formatDayMonth(sel.from) : "Выберите дату"}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Вернуть</div>
            <div className={`text-xs ${sel.to ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
              {sel.to ? formatDayMonth(sel.to) : "Выберите дату"}
            </div>
          </div>
        </div>

        {(sel.from || sel.to) && (
          <button
            type="button"
            onClick={clearDates}
            className="mx-auto mt-1 block text-xs font-medium text-primary hover:underline"
          >
            Очистить даты
          </button>
        )}

        {props.quantity > 1 && (
          <label className="mt-3 flex items-center justify-between gap-2 text-sm text-muted-foreground">
            Количество
            <select
              value={sel.qty}
              onChange={(e) => setQty(Number(e.target.value))}
              className={`${field} h-10 w-20 px-2 text-sm`}
            >
              {Array.from({ length: props.quantity }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
        )}

        {/* Итог */}
        <div className="mt-3 border-t border-foreground/10 pt-3 text-center">
          {estimate !== null ? (
            <div className="flex items-baseline justify-center gap-2">
              <span className="font-mark text-xl font-bold tracking-tight">{formatPrice(estimate)}</span>
              <span className="text-sm text-muted-foreground">
                за {days} дн.{sel.qty > 1 ? ` · ${sel.qty} шт.` : ""}
              </span>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Выберите даты, чтобы увидеть цену.</div>
          )}
        </div>

        {conflictMessage && <div className="mt-2">{conflictMessage}</div>}

        {bookSlot("mt-3 w-full")}
      </div>

      {/* Цена и залог — отдельным блоком под виджетом (не на подложке) */}
      <div className="mt-2">
        <div className="mb-2 text-center font-mono text-2xs font-medium uppercase tracking-mono text-muted-foreground">
          Цена и залог
        </div>
        <div className="flex gap-2">
          {priceBoxes.map((b) => (
            <div key={b.label} className="flex-1 rounded-lg border border-border bg-card p-3 text-center">
              <div className="font-mark font-bold">{b.value}</div>
              <div className="text-xs text-muted-foreground">{b.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Способ получения — своим блоком под виджетом, как и цены: это свойство
        * самой вещи, а не параметр брони, и в ряд плиток он не встаёт — там
        * flex-1 без min-w-0, и текстовое значение на узком экране распёрло бы
        * ряд до горизонтального скролла.
        * Значение не приглушено: способ получения решает, подойдёт ли вещь
        * вообще. Значок — общий HandoverIcon, тот же, что в карточке выдачи:
        * человек приходит сюда прямо оттуда и не должен опознавать свойство
        * заново. */}
      <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-border bg-card p-3 text-sm">
        <span className="text-muted-foreground">Получение</span>
        <span className="flex min-w-0 items-center gap-1.5 font-semibold text-foreground">
          <HandoverIcon pickup={props.handoverPickup} delivery={props.handoverDelivery} />
          <span className="truncate">
            {formatHandover(props.handoverPickup, props.handoverDelivery)}
          </span>
        </span>
      </div>

      {/* Mobile: нижняя панель действий вместо таб-бара. Две панели друг на
       * друге съедали низ экрана, поэтому на карточке чужой вещи таб-бар
       * скрыт — его прячет globals.css по маркеру data-booking-bar, там же
       * --bottom-bar-h под подвал. Высота панели — ровно эта переменная:
       * кант 1px + строка h-16 + полоса «домой»; меняете одно — правьте и
       * другое.
       * Владельцу полосы нет вовсе: без кнопки она весь экран носила бы его же
       * цену, и таб-бар у него остаётся.
       * z-[41] — на ступень выше таб-бара (z-40, он позже в DOM): где :has()
       * не поддержан, таб-бар не прячется и иначе лёг бы поверх кнопки. */}
      {!props.isOwn && <div
        data-booking-bar
        className="fixed inset-x-0 bottom-0 z-[41] border-t border-border bg-card pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] md:hidden"
      >
        <div className="mx-auto flex h-16 max-w-[480px] items-center justify-between gap-3 px-4">
          <span className="min-w-0">
            <span className="block font-mark text-base font-bold">
              {estimate !== null
                ? `≈ ${formatPrice(estimate)}`
                : `${formatPrice(props.priceDay)}/сутки`}
            </span>
            {hasComplete && (
              <span className="block text-2xs text-muted-foreground">
                {formatDayMonth(sel.from)} — {formatDayMonth(sel.to)}
              </span>
            )}
          </span>
          {barAction}
        </div>
      </div>}

      <LoginDialog
        open={loginOpen}
        onOpenChange={setLoginOpen}
        callbackUrl={callbackUrl}
        {...props.authProps}
      />

      <BookingFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        listingId={props.listingId}
        listingTitle={props.listingTitle}
        sel={sel}
        priceDay={props.priceDay}
        initialPhone={props.initialPhone}
      />
    </>
  );
}
