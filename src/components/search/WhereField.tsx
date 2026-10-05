"use client";

import { useState } from "react";
import { History as RecentIcon, LocateFixed, MapPin } from "lucide-react";
import { content } from "@theme/content";
import { cn } from "@/lib/utils";
import type { CityGeoContext } from "@/lib/geo/context";
import type { AddressHit } from "@/lib/geo/address";
import type { UserPoint } from "@/lib/geo/location";
import { precisionNote } from "@/lib/geo/precision";
import { Modal, ModalContent, ModalTitle } from "@/components/ui/Modal";
import { Button } from "@/components/ui/button";
import { filterChip } from "@/components/ui/filter-chip";
import { AddressCombobox, addressValueOf, type AddressExtraRow, type AddressValue } from "./AddressCombobox";
import { useCanGeolocate, useGeolocate } from "./geolocate";
import { storeLocation, useStoredLocation } from "./stored-location";

const t = content.search.where;

/** Город «Где»: рисуется только там, где у города есть геоданные. */
export interface WhereCity {
  slug: string;
  name: string;
  geo: CityGeoContext;
}

/** Подпись точки в поле и в чипе: `la`, иначе — откуда точка. */
export function whereLabel(p: UserPoint): string {
  return p.label ?? (p.source === "geo" ? t.myLocation : t.point);
}

const samePoint = (a: UserPoint, b: UserPoint | null) =>
  !!b && a.point.lat.toFixed(3) === b.point.lat.toFixed(3) && a.point.lon.toFixed(3) === b.point.lon.toFixed(3);

// «Где» в панели поиска (перенос WhereField из sravniprokat без справочника
// микрорайонов и округов): адрес из своего геокодера через AddressCombobox или
// геолокация браузера. Значение — точка с точностью (lib/geo/location.ts);
// город она не меняет, а выдача с ней берёт весь регион и считает расстояния.
//
// - Улица, ЖК, посёлок — точка с «≈» (lp=s|t), дом — точная. Город и округ
//   целиком точки не дают: выбор означает «весь город» (значение null).
// - «Моё местоположение» — геолокация; подпись — обратный геокодер без номера
//   дома (она уходит в адрес страницы). Точность хуже 150 м — расстояния с «≈».
//   Отказ — без ошибки: поле остаётся для ввода.
// - «Недавнее: …» — последнее место с этого устройства (stored-location.ts).
//   Только строка списка: применённым значением оно не становится.
//
// Раскладка повторяет «Когда»: с lg — поле в панели и поповер подсказок; ниже
// — шторка Modal с полем и списком под ним. В шапке ниже lg шторку открывает
// чип в панели подсказок «Что» (sheetOpen снаружи); в hero — своя кнопка.
// Оба вида в DOM сразу и переключаются классами: поле, а не кнопка, нужно с
// первого кадра, а ширину экрана сервер не знает.
//
// Выбор — черновик панели: переход по-прежнему кнопкой поиска.
export function WhereField({
  variant, city, value, onChange, track, sheetOpen, onSheetOpenChange, returnFocus, className,
}: {
  variant: "header" | "hero";
  city: WhereCity;
  value: UserPoint | null;
  onChange: (p: UserPoint | null) => void;
  /** Место определяется асинхронно (Enter по адресу, геолокация) — поиск ждёт этот промис. */
  track?: (pending: Promise<void>) => void;
  /** Шторка под управлением снаружи — её открывает чип панели подсказок. */
  sheetOpen?: boolean;
  onSheetOpenChange?: (open: boolean) => void;
  /** Куда вернуть фокус, когда шторка закрылась (чип к тому времени размонтирован). */
  returnFocus?: () => HTMLElement | null;
  className?: string;
}) {
  const { region } = city.geo;
  const [ownSheet, setOwnSheet] = useState(false);
  const sheet = sheetOpen ?? ownSheet;
  const setSheet = (open: boolean) => {
    if (sheetOpen === undefined) setOwnSheet(open);
    onSheetOpenChange?.(open);
  };

  // localStorage и navigator — только на клиенте, после гидрации: разметка
  // сервера и первого кадра обязана совпасть (оба стора отдают серверу пусто).
  const stored = useStoredLocation(region);
  const canLocate = useCanGeolocate();
  const geo = useGeolocate({ slug: city.slug, name: city.name, region });
  const { locating } = geo;

  const apply = (p: UserPoint | null) => {
    // Ждущая геолокация устарела: место выбрано иначе.
    geo.cancel();
    storeLocation(region, p);
    onChange(p);
  };

  const onPick = (hit: AddressHit) => {
    const v = addressValueOf(hit, city.name);
    // Город и округ — «весь город»: расстояние до их центра было бы ложным числом.
    apply(v.point && v.precision !== "city"
      ? { point: v.point, label: v.label, source: "address", precision: v.precision }
      : null);
  };

  // Пока ждали, выбрали другое место или снова нажали «Моё местоположение» —
  // ответ устарел (stale) и не применяется. Отказ — поле остаётся для ввода.
  const locate = async (): Promise<void> => {
    const r = await geo.locate();
    if (r.status === "ok") onChange(r.point);
  };

  const recent = stored && !samePoint(stored, value) ? stored : null;
  const extras = (after?: () => void): AddressExtraRow[] => [
    ...(recent ? [{
      key: "recent",
      label: t.recent(whereLabel(recent)),
      hint: precisionNote(recent.precision, "where") ?? undefined,
      icon: <RecentIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />,
      position: "start" as const,
      idle: true,
      onSelect: () => { apply(recent); after?.(); },
    }] : []),
    ...(canLocate ? [{
      key: "geo",
      label: locating ? t.locating : t.myLocation,
      // Зелёный — иконкой, не текстом: как текст на белом он контраста не держит.
      icon: <LocateFixed className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />,
      position: "end" as const,
      onSelect: async () => { await locate(); after?.(); },
    }] : []),
  ];

  const fieldValue: AddressValue | null = value
    ? { label: whereLabel(value), precision: value.precision, point: value.point }
    : null;
  const placeholder = locating ? t.locating : t.placeholder;
  const common = {
    citySlug: city.slug,
    cityName: city.name,
    geo: city.geo,
    value: fieldValue,
    onPick,
    onClear: () => apply(null),
    mode: "where" as const,
    stored: stored?.point ?? null,
    placeholder,
    label: t.label,
    track,
  };

  const closeSheet = () => setSheet(false);
  const sheetExtras = extras(closeSheet);

  const sheetBox = (
    <Modal open={sheet} onOpenChange={setSheet}>
      <ModalContent
        aria-describedby={undefined}
        className="md:max-w-[26rem]"
        onCloseAutoFocus={(e) => {
          const target = returnFocus?.();
          if (!target) return;
          e.preventDefault();
          target.focus();
        }}
      >
        <ModalTitle className="mb-3 text-lg font-bold">{t.title}</ModalTitle>
        <AddressCombobox
          {...common}
          id={`where-${variant}-sheet`}
          onPick={(hit) => { onPick(hit); closeSheet(); }}
          list="inline"
          framed
          labelClassName="sr-only"
        />
        {/* Геолокация и прошлое место — видны сразу, без фокуса в поле: шторка
          * клавиатуру не поднимает, и пустое поле иначе ничего бы не предлагало. */}
        {sheetExtras.length > 0 && (
          <div className="mt-2 flex flex-col">
            {sheetExtras.map((x) => (
              <button
                key={x.key}
                type="button"
                onClick={() => { const p = Promise.resolve(x.onSelect()); track?.(p); }}
                className="hoverable flex min-h-[44px] items-center gap-3 rounded-sm px-3 py-2 text-left"
              >
                {x.icon}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[15px] text-foreground">{x.label}</span>
                  {x.hint && <span className="truncate text-[13px] text-muted-foreground">{x.hint}</span>}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="mt-3 flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={() => { apply(null); closeSheet(); }}>{t.any}</Button>
          <Button type="button" className="flex-1" onClick={closeSheet}>{content.search.when.done}</Button>
        </div>
      </ModalContent>
    </Modal>
  );

  if (variant === "header") {
    return (
      <>
        <div className={cn("hidden min-w-0 items-center gap-1.5 pl-2 lg:flex", className)}>
          <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <AddressCombobox
            {...common}
            id="where-header"
            extras={extras()}
            labelClassName="sr-only"
            inputClassName="text-sm"
            showNote={false}
            className="flex-1"
          />
        </div>
        {sheetBox}
      </>
    );
  }

  const valueText = value ? whereLabel(value) : t.any;
  return (
    <>
      {/* Ниже lg — кнопка, как у «Когда»: поле в узкой колонке hero подняло бы
        * клавиатуру над поповером, а шторка держит и поле, и список. */}
      <button
        type="button"
        onClick={() => setSheet(true)}
        aria-label={`${t.label}: ${valueText}`}
        className={cn("hoverable flex min-w-0 flex-col justify-center gap-0.5 rounded-sm px-3 py-1.5 text-left md:px-4 lg:hidden", className)}
      >
        <span className="truncate text-xs text-muted-foreground">{t.label}</span>
        <span className={cn(
          "truncate py-0.5 text-base md:text-[17px]",
          value ? "font-semibold text-foreground" : "text-muted-foreground",
        )}>
          {valueText}
        </span>
      </button>
      <AddressCombobox
        {...common}
        id="where-hero"
        extras={extras()}
        labelClassName="text-xs text-muted-foreground"
        inputClassName="py-0.5 text-base font-semibold placeholder:font-normal md:text-[17px]"
        showNote={false}
        className={cn("hidden justify-center gap-0.5 px-3 py-1.5 md:px-4 lg:flex", className)}
      />
      {sheetBox}
    </>
  );
}

/** Чип «Где» в верхней строке панели подсказок (шапка ниже lg). */
export function WhereChip({ value, onClick }: { value: UserPoint | null; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${t.label}: ${value ? whereLabel(value) : t.any}`}
      className={cn(filterChip(Boolean(value)), "h-9 min-w-0 text-sm")}
    >
      <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{value ? whereLabel(value) : t.label}</span>
    </button>
  );
}
