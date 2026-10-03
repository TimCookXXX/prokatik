"use client";

import { useEffect, useRef, useState } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { MapPin, X } from "lucide-react";
import { content } from "@theme/content";
import { cn } from "@/lib/utils";
import { ruPlural } from "@/lib/plural";
import type { CityGeoContext } from "@/lib/geo/context";
import type { GeoPoint } from "@/lib/geo/point";
import {
  hasHouseNumber, hitKey, hitLabel, needsServer, sameTyping, shouldApply, suggestNear, visibleAddresses,
  type AddressHit, type SuggestReply,
} from "@/lib/geo/address";
import { isCoarsePlace, listingPrecision, precisionNote, type GeoPrecision } from "@/lib/geo/precision";
import { fieldWithin } from "@/components/ui/field";
import { PopoverContent } from "@/components/ui/Popover";
import { ADDRESS_DEBOUNCE_MS, fetchAddressHits, loadClientGeocoder, type ClientSuggester } from "./address-client";

const ADDRESS_LIMIT = 7;

/** Что показывает поле, когда его не редактируют. */
export interface AddressValue {
  /** Подпись в поле: hitLabel выбранного хита или сохранённый адрес. */
  label: string;
  /** Точность — для подписи под полем. */
  precision: GeoPrecision;
  /** Вид хита: объект подписывается «≈ до объекта», а не «≈ населённый пункт». */
  kind?: AddressHit["kind"];
  /** Точка — `near` следующих подсказок; null — точки нет. */
  point: GeoPoint | null;
}

/** Выбранный хит → значение поля. Город и округ точки не дают («весь город»). */
export function addressValueOf(hit: AddressHit, cityName: string): AddressValue {
  const precision = listingPrecision(hit);
  return {
    label: hitLabel(hit, cityName),
    precision: precision ?? "city",
    kind: hit.kind,
    point: precision ? { lat: hit.lat, lon: hit.lon } : null,
  };
}

/**
 * Строка списка не из геокодера: «Недавнее: …», «Моё местоположение» в «Где».
 * `start` — над адресами, `end` — под ними. Видна и без набранного текста.
 */
export interface AddressExtraRow {
  key: string;
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  position: "start" | "end";
  onSelect: () => void | Promise<void>;
}

type Row = { kind: "hit"; key: string; hit: AddressHit } | { kind: "extra"; key: string; extra: AddressExtraRow };

const prevent = (e: React.SyntheticEvent | Event) => e.preventDefault();

// Ядро поля адреса (перенос WhereField из sravniprokat без справочника мест):
// адрес объявления в форме (`listing`) и «Где» в поиске (`where`). Улицы,
// пункты и объекты — мгновенно из мини-индекса браузера (грузится при первом
// фокусе и собирается в Web Worker, address-client.ts), дома — с сервера через
// паузу после ввода. Подсказка сразу несёт координаты и точность.
//
// Ввели и не выбрали (Enter, уход с поля) — берётся первая подсказка того же
// списка; подсказок нет — «Не нашли такой адрес» и значение сбрасывается
// (onClear): в поле не должно остаться текста, за которым нет точки.
//
// В `listing` город и округ целиком в списке не показываются — адресом
// объявления они не принимаются (lib/geo/precision.ts). Подпись точности —
// под полем (что увидят покупатели) и в каждой строке.
//
// Фокус всегда в поле: курсор по строкам — aria-activedescendant, строки
// отмечены data-active (globals.css), как у WhatField.
export function AddressCombobox({
  id, citySlug, cityName, geo, value, onPick, onClear, mode, list = "popover", stored = null, extras = [],
  label, labelClassName, placeholder, framed = mode === "listing", className, inputClassName,
  invalid, describedBy, track, showNote = true,
}: {
  /** Стабильный id: не useId, поле рендерится и на сервере, ids совпадают при гидрации. */
  id: string;
  citySlug: string;
  /** Город страницы или объявления: в подписях пункт этого города не повторяется. */
  cityName: string;
  /** Гео-контекст города: регион, центр (`near` по умолчанию) и метка мини-индекса. */
  geo: CityGeoContext;
  value: AddressValue | null;
  onPick: (hit: AddressHit) => void;
  /** Поле очистили или набранное не нашлось. */
  onClear?: () => void;
  mode: "listing" | "where";
  /** Поповер в портале (шапка, форма) или список в потоке под полем (шторка). */
  list?: "popover" | "inline";
  /** Последнее место с этого устройства — `near`, пока ничего не выбрано. */
  stored?: GeoPoint | null;
  extras?: AddressExtraRow[];
  label?: string;
  labelClassName?: string;
  placeholder: string;
  /** Своя рамка fieldWithin; в панели поиска рамку несёт панель. */
  framed?: boolean;
  className?: string;
  inputClassName?: string;
  invalid?: boolean;
  /** id ошибки формы — к нему добавится подпись точности. */
  describedBy?: string;
  /** Выбор бывает асинхронным (первая подсказка по Enter): «Найти» ждёт этот промис. */
  track?: (pending: Promise<void>) => void;
  /** Подпись точности под полем; в узкой панели шапки ей нет места. */
  showNote?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const [client, setClient] = useState<ClientSuggester | null>(null);
  // Последний ответ мини-индекса: держится, пока не пришёл ответ на новый
  // текст (без мигания), — если он про этот же ввод, а не про стёртый целиком.
  const [clientReply, setClientReply] = useState<{ q: string; items: AddressHit[] } | null>(null);
  const [server, setServer] = useState<SuggestReply | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const picked = useRef(false);
  const seq = useRef(0);
  const shownSeq = useRef(0);

  const valueLabel = value?.label ?? "";
  const q = query ?? "";
  const qRef = useRef(q);
  qRef.current = q;
  const typing = query !== null && q.trim().length >= 2 && q !== valueLabel;
  // Рядом с выбранным местом, без него — с прошлым выбором на этом устройстве,
  // иначе от центра города: одноимённые улицы своего пункта выше.
  const near = suggestNear(value?.point ?? null, stored, geo.centre);
  const nearLat = near.lat;
  const nearLon = near.lon;

  const accept = (hits: AddressHit[]) =>
    (mode === "listing" ? hits.filter((h) => !isCoarsePlace(h)) : hits).slice(0, ADDRESS_LIMIT);

  // Мини-индекс — один раз, при первом фокусе поля.
  const loadClient = () => {
    if (client) return;
    void loadClientGeocoder(citySlug, geo.token).then((g) => { if (g) setClient(g); });
  };

  // Улицы, пункты, объекты — из мини-индекса на каждое нажатие (в воркере:
  // доли миллисекунды и пересылка). Ответ на уже изменённый текст
  // отбрасывается; воркер упал (null) — только сервер.
  useEffect(() => {
    if (!client || !typing) return;
    let live = true;
    void client.suggest(q, { limit: ADDRESS_LIMIT, near: { lat: nearLat, lon: nearLon } }).then((items) => {
      if (!live) return;
      if (items === null) {
        setClient(null);
        setClientReply(null);
      } else setClientReply({ q, items });
    });
    return () => { live = false; };
  }, [client, typing, q, nearLat, nearLon]);
  const clientHits = client && typing && clientReply && sameTyping(clientReply.q, q) ? clientReply.items : null;

  // Дома — с сервера, с короткой паузой. Запрос в полёте не отменяем, а
  // сверяем его ответ (shouldApply): устаревший отбрасывается.
  useEffect(() => {
    if (!typing || !needsServer(q, !!client)) return;
    const t = setTimeout(async () => {
      const mine = ++seq.current;
      const items = await fetchAddressHits(citySlug, q.trim(), { lat: nearLat, lon: nearLon });
      if (items && shouldApply({ seq: mine, q }, shownSeq.current, qRef.current)) {
        shownSeq.current = mine;
        setServer({ seq: mine, q: q.trim(), items });
        setActive(-1);
      }
    }, ADDRESS_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [typing, q, client, citySlug, nearLat, nearLon]);

  const hits = typing ? accept(visibleAddresses(q, server, clientHits)) : [];
  const rows: Row[] = [
    ...extras.filter((x) => x.position === "start").map((extra) => ({ kind: "extra" as const, key: `x:${extra.key}`, extra })),
    ...hits.map((hit) => ({ kind: "hit" as const, key: `a:${hitKey(hit)}`, hit })),
    ...extras.filter((x) => x.position === "end").map((extra) => ({ kind: "extra" as const, key: `x:${extra.key}`, extra })),
  ];
  const open = query !== null && rows.length > 0;

  // Закрыть список. `blur` — после выбора пальцем или мышью: спрятать
  // клавиатуру телефона; onBlur тогда не разбирает набранный текст (picked).
  // С клавиатуры (Escape, Enter по строке) фокус остаётся в поле, как у
  // WhatField: дальнейший ввод снова откроет список.
  const close = (blur: boolean) => {
    setQuery(null);
    setActive(-1);
    if (blur) { picked.current = true; inputRef.current?.blur(); }
  };

  const choose = async (row: Row, blur: boolean): Promise<void> => {
    setNotice(null);
    close(blur);
    if (row.kind === "hit") onPick(row.hit);
    else await row.extra.onSelect();
  };

  /** Ввели и не выбрали: первая подсказка того же списка, без ожидания паузы. */
  const resolveTyped = async (text: string): Promise<void> => {
    let found: AddressHit[] | null;
    if (server && server.q.toLowerCase() === text.toLowerCase()) found = server.items;
    else {
      const local = client && !hasHouseNumber(text)
        ? await client.suggest(text, { limit: ADDRESS_LIMIT, near })
        : null;
      // Сервер не ответил — хотя бы улица из мини-индекса.
      found = local ?? await fetchAddressHits(citySlug, text, near)
        ?? (client ? await client.suggest(text, { limit: ADDRESS_LIMIT, near }) : null);
    }
    // В форме объявления лучший ответ — город целиком: не подменяем его
    // случайной строкой ниже («краснодар» → «ТЦ Галерея Краснодар»), а просим
    // уточнить.
    if (mode === "listing" && found?.[0] && isCoarsePlace(found[0])) {
      onClear?.();
      setNotice(content.address.tooCoarse);
      return;
    }
    const first = found ? accept(found)[0] : undefined;
    if (first) {
      onPick(first);
      return;
    }
    onClear?.();
    setNotice(found === null ? content.address.failed : content.address.notFound);
  };

  const pick = (row: Row, blur: boolean) => {
    const p = choose(row, blur);
    track?.(p);
    return p;
  };

  const onBlur = () => {
    if (picked.current) { picked.current = false; return; }
    if (query === null) return;
    const text = q.trim();
    setQuery(null);
    setActive(-1);
    if (!text) { if (value) onClear?.(); return; }
    if (!typing) return;
    // Не track?.(resolveTyped(…)): без track опциональный вызов не вычислил бы и аргумент.
    const p = resolveTyped(text);
    track?.(p);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Enter по набранному тексту без выбора: сначала определяем адрес. В «Где»
    // затем отправляется форма поиска; в форме объявления — нет.
    if (e.key === "Enter" && active < 0 && typing) {
      e.preventDefault();
      const form = inputRef.current?.form;
      const text = q.trim();
      // Фокус остаётся в поле: query = null, и уход с поля потом ничего не
      // разберёт, а дальнейший ввод — разберёт заново.
      setQuery(null);
      const p = resolveTyped(text);
      track?.(p);
      if (mode === "where") void p.then(() => form?.requestSubmit());
      return;
    }
    if (e.key === "Enter" && mode === "listing" && query !== null) {
      // Enter в поле адреса не отправляет форму объявления целиком.
      e.preventDefault();
    }
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % rows.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a <= 0 ? rows.length - 1 : a - 1)); }
    else if (e.key === "Enter" && active >= 0 && rows[active]) { e.preventDefault(); void pick(rows[active], false); }
    else if (e.key === "Escape") { e.preventDefault(); close(false); }
  };

  const listId = `${id}-list`;
  const noteId = `${id}-note`;
  const optionId = (i: number) => `${id}-opt-${i}`;
  const note = notice ?? (showNote && value && query === null ? precisionNote(value.precision, mode, value.kind) : null);
  const announce = open && typing ? `${hits.length} ${ruPlural(hits.length, ...content.search.suggestCount)}` : "";

  const listBox = open && (
    <div
      id={listId}
      role="listbox"
      aria-label={label ?? content.address.suggestLabel}
      className={cn("flex flex-col py-1.5", list === "inline" && "mt-1 border-t border-border")}
    >
      {rows.map((row, i) => (
        <div
          key={row.key}
          id={optionId(i)}
          role="option"
          aria-selected={i === active}
          data-active={i === active}
          onMouseDown={prevent}
          onMouseEnter={() => setActive(i)}
          onClick={() => void pick(row, true)}
          className="flex min-h-[44px] cursor-pointer items-center gap-3 px-4 py-2 text-left"
        >
          {row.kind === "extra" && row.extra.icon ? row.extra.icon : (
            <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="line-clamp-2 text-[15px] leading-snug text-foreground">
              {row.kind === "hit" ? row.hit.title : row.extra.label}
            </span>
            {(row.kind === "hit" || row.extra.hint) && (
              <span className="truncate text-[13px] leading-snug text-muted-foreground">
                {row.kind === "hit" ? hitSubtitle(row.hit, cityName) : row.extra.hint}
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  );

  const input = (
    <input
      ref={inputRef}
      id={`${id}-input`}
      type="text"
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={open}
      // Ссылка только на смонтированный список (как у WhatField).
      aria-controls={open ? listId : undefined}
      aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
      aria-invalid={invalid || undefined}
      aria-describedby={[describedBy, note ? noteId : null].filter(Boolean).join(" ") || undefined}
      autoComplete="off"
      autoCapitalize="off"
      spellCheck={false}
      enterKeyHint={mode === "where" ? "search" : "done"}
      placeholder={placeholder}
      value={query ?? valueLabel}
      onFocus={(e) => {
        picked.current = false;
        setNotice(null);
        setServer(null);
        setClientReply(null);
        setQuery(valueLabel);
        setActive(-1);
        e.currentTarget.select();
        loadClient();
      }}
      onChange={(e) => { picked.current = false; setQuery(e.target.value); setActive(-1); }}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      className={cn(
        "w-full min-w-0 truncate bg-transparent text-foreground outline-none placeholder:text-muted-foreground",
        inputClassName,
      )}
    />
  );

  const clear = (value || q !== "") && (
    <button
      type="button"
      aria-label={content.address.clear}
      onMouseDown={prevent}
      onClick={() => {
        setNotice(null);
        if (query !== null) setQuery("");
        onClear?.();
      }}
      className="hoverable grid h-7 w-7 shrink-0 place-items-center rounded-sm text-muted-foreground"
    >
      <X className="h-4 w-4" aria-hidden="true" />
    </button>
  );

  return (
    // Сам Radix закрывает поповер только по Escape. Клик и фокус снаружи — это
    // уход с поля (onInteractOutside): onBlur разбирает набранный текст. Закрой
    // их Radix через close(true), picked заглушил бы onBlur и текст пропал бы.
    <PopoverPrimitive.Root open={list === "popover" && open} onOpenChange={(o) => { if (!o) close(false); }}>
      <div className={cn("flex min-w-0 flex-col", className)}>
        {label && <label htmlFor={`${id}-input`} className={labelClassName}>{label}</label>}
        <PopoverPrimitive.Anchor asChild>
          <div
            ref={anchorRef}
            className={cn("flex items-center gap-1", framed && cn(fieldWithin, "h-11 pl-3 pr-2"))}
          >
            {input}
            {clear}
          </div>
        </PopoverPrimitive.Anchor>
        {note && (
          <p id={noteId} className="mt-1 text-xs text-muted-foreground">{note}</p>
        )}
        {list === "inline" && listBox}
      </div>

      <div role="status" className="sr-only">{announce}</div>

      {list === "popover" && open && (
        <PopoverContent
          // Обёртка списка, а не диалог: фокус в нём не бывает.
          role="presentation"
          onOpenAutoFocus={prevent}
          onCloseAutoFocus={prevent}
          onInteractOutside={(e) => {
            e.preventDefault();
            // Тап мимо поля на телефоне фокус сам не снимает.
            if (!anchorRef.current?.contains(e.target as Node)) inputRef.current?.blur();
          }}
          onMouseDown={prevent}
          className="max-h-[min(70vh,440px)] w-[min(420px,calc(100vw-32px))] min-w-[var(--radix-popover-trigger-width)] overflow-y-auto p-0"
        >
          {listBox}
        </PopoverContent>
      )}
    </PopoverPrimitive.Root>
  );
}

/** Вторая строка подсказки: «Яблоновский» / «микрорайон, Краснодар» и «≈ до улицы», если точка не дома. */
function hitSubtitle(hit: AddressHit, cityName: string): string {
  const note = precisionNote(listingPrecision(hit), "where", hit.kind);
  return [hit.subtitle || cityName, note].filter(Boolean).join(" · ");
}
