"use client";

// Форма позиции (create/edit). Фото грузятся сразу через /api/upload
// (sharp → webp → S3) и попадают в photos_json при сохранении формы.

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { HandoverIcon } from "@/components/catalog/HandoverIcon";
import { Button } from "@/components/ui/button";
import { FormBlock } from "@/components/cabinet/FormBlock";
import { StepProgress } from "@/components/cabinet/StepProgress";
import { PhotoDrop, type Photo } from "@/components/cabinet/PhotoDrop";
import { field } from "@/components/ui/field";
import { AddressCombobox, addressValueOf, type AddressValue } from "@/components/search/AddressCombobox";
import { createListing, updateListing } from "@/server/actions/owner";
import type { AddressHit } from "@/lib/geo/address";
import type { CityGeoContext } from "@/lib/geo/context";
import type { ListingAddressInput } from "@/lib/owner/validation";
import { content } from "@theme/content";

export interface ListingFormValues {
  title: string;
  cityId: string;
  categoryId: string;
  description: string;
  priceDay: string;
  depositType: "money" | "document" | "none";
  depositAmount: string;
  quantity: string;
  handoverPickup: boolean;
  handoverDelivery: boolean;
  photos: Photo[];
}

const INPUT = `${field} h-11 px-3`;
const MAX_PHOTOS = 10;
const A = content.address.listing;

/** Город в форме: гео-контекст решает, выбирается адрес из подсказок или пишется текстом. */
export interface ListingFormCity {
  id: string;
  name: string;
  slug: string;
  /** null — у города нет геоданных: адрес текстом, без точки. */
  geo: CityGeoContext | null;
}

/**
 * Поле адреса (docs/decisions/0021). В городе с геоданными — подсказки
 * геокодера (`value` и `pick`), без них — текст. `payload` — что уйдёт в
 * action: `keep`, пока сохранённый адрес не трогали; null — адреса нет, и
 * сохранять нечего.
 */
interface AddressState {
  value: AddressValue | null;
  text: string;
  payload: ListingAddressInput | null;
  /** Сохранённый адрес без точки там, где точка нужна: его показываем подсказкой. */
  legacy: string | null;
}

const NO_ADDRESS: AddressState = { value: null, text: "", payload: null, legacy: null };

function initialAddress(saved: AddressValue | null | undefined, geo: CityGeoContext | null): AddressState {
  if (!saved) return NO_ADDRESS;
  if (!geo) return { ...NO_ADDRESS, text: saved.label, payload: { mode: "keep" } };
  // Точки нет, а у города геоданные есть — legacy-строка или адрес, который не
  // нашёл backfill. «Оставить» его сервер не даст: выбрать из подсказок.
  if (saved.precision === "city") return { ...NO_ADDRESS, legacy: saved.label };
  return { ...NO_ADDRESS, value: saved, payload: { mode: "keep" } };
}

/** Подсказка → payload: координаты — заявка, сервер найдёт тот же адрес у себя. */
const pickPayload = (hit: AddressHit): ListingAddressInput => ({
  mode: "pick", kind: hit.kind, title: hit.title, subtitle: hit.subtitle, lat: hit.lat, lon: hit.lon,
});

// Отказы resolveListingAddress и схемы адреса: их показываем у поля, а не
// внизу формы. «Форма устарела» — про форму целиком, она остаётся внизу.
const ADDRESS_ERRORS = new Set<string>([
  A.required, A.pickFromList, A.textLength, A.tooFar, A.unavailable, content.address.tooCoarse,
]);

const ADDRESS_ID = "listing-address";

// Способ получения — галочка видом чипа, как в фильтрах каталога. Чип оттуда не
// переиспользуется: там это radio с defaultChecked, а здесь способов можно
// выбрать два, и значение живёт в состоянии формы.
//
// Ввод sr-only, поэтому кольцо фокуса рисуется вручную: без него обязательное
// поле не видно с клавиатуры. Наружное и с отступом — то же, что у чипов
// фильтров и по той же причине: цвет кольца совпадает с кантом отмеченного
// чипа, и вплотную его было бы не различить.
function HandoverChip({
  label, icon, checked, onChange,
}: {
  label: string;
  icon: React.ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={`inline-flex h-11 cursor-pointer items-center gap-2 rounded-lg border border-border
        bg-background px-4 text-sm text-muted-foreground transition-colors hover:text-foreground
        has-[:checked]:border-accent has-[:checked]:bg-selected has-[:checked]:text-selected-foreground
        has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring
        has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background`}
    >
      <input
        type="checkbox" checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      {icon}
      {label}
    </label>
  );
}

export function ListingForm({
  mode, listingId, cities, categories, initial, savedAddress, sellerName: initialSellerName = "",
  returnHref = "/cabinet/listings",
}: {
  mode: "create" | "edit";
  listingId?: string;
  /**
   * Куда уйти после сохранения. По умолчанию список объявлений, но правка
   * архивного возвращает в архив: статус форма не меняет, и в общем списке
   * такого объявления нет — человек попадал бы в никуда.
   */
  returnHref?: string;
  cities: ListingFormCity[];
  // Подкатегории (или корневые без детей) — позиция вешается на лист дерева.
  categories: Array<{ id: string; name: string }>;
  initial: ListingFormValues;
  /**
   * Сохранённый адрес (правка): поле предзаполнено им и шлёт `keep`, пока его
   * не тронули. null — адреса ещё нет (legacy-строка), выбрать обязательно.
   */
  savedAddress?: AddressValue | null;
  // Текущее имя владельца: показываем при первой публикации, чтобы он увидел,
  // как его назовут покупатели, и мог заменить прямо здесь.
  sellerName?: string;
}) {
  const [v, setV] = useState(initial);
  const [sellerName, setSellerName] = useState(initialSellerName);
  const [error, setError] = useState<string | null>(null);
  const city = cities.find((c) => c.id === v.cityId) ?? null;
  const [address, setAddressState] = useState(() => initialAddress(savedAddress, city?.geo ?? null));
  const [addressError, setAddressError] = useState<string | null>(null);
  // Отправка читает адрес после ожидания: поле может ещё подбирать первую
  // подсказку под набранный текст (ушли с поля прямо на «Сохранить»).
  const addressRef = useRef(address);
  const addressPending = useRef<Promise<void> | null>(null);
  // Город, к которому относится адрес. Выбор бывает асинхронным (первая
  // подсказка после ухода с поля ждёт сервер), а город за это время могут
  // сменить: ответ поля старого города тогда отбрасывается.
  const addressCity = useRef(v.cityId);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const set = (patch: Partial<ListingFormValues>) => setV((cur) => ({ ...cur, ...patch }));

  // Слиянием с ref, а не с состоянием рендера: выбор бывает асинхронным
  // (первая подсказка после ухода с поля) и приходит в старое замыкание.
  const setAddress = (patch: Partial<AddressState>) => {
    const next = { ...addressRef.current, ...patch };
    addressRef.current = next;
    setAddressState(next);
    setAddressError(null);
  };

  // Адрес принадлежит городу: в другом городе прежний выбор не значит ничего,
  // и «оставить как было» сервер не примет.
  const changeCity = (cityId: string) => {
    if (cityId === v.cityId) return;
    set({ cityId });
    addressCity.current = cityId;
    setAddress(NO_ADDRESS);
  };

  const changeAddress = (cityId: string, patch: Partial<AddressState>) => {
    if (cityId === addressCity.current) setAddress(patch);
  };

  const focusAddress = () => document.getElementById(`${ADDRESS_ID}-input`)?.focus();

  // Сколько блоков уже собрано — по тому же смыслу, что и их заголовки.
  // Не валидация: сервер всё равно проверит, здесь только счётчик объёма.
  const blocksDone = useMemo(
    () =>
      [
        v.title.trim().length >= 3 && v.categoryId !== "",
        v.photos.length > 0,
        Number(v.priceDay) > 0,
        v.cityId !== "" && Number(v.quantity) > 0
          && (v.handoverPickup || v.handoverDelivery) && address.payload !== null,
      ].filter(Boolean).length,
    [v, address.payload],
  );

  const uploadFiles = async (files: FileList) => {
    setUploadError(null);
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, MAX_PHOTOS - v.photos.length)) {
        const fd = new FormData();
        fd.append("image", file);
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body?.file?.url) {
          setUploadError(res.status === 503
            ? "Хранилище изображений не настроено (STORAGE_* в .env) — позицию можно сохранить без фото."
            : "Не удалось загрузить фото.");
          break;
        }
        setV((cur) => ({
          ...cur,
          photos: [...cur.photos, { url: body.file.url, width: body.file.width, height: body.file.height }],
        }));
      }
    } finally {
      setUploading(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setAddressError(null);
    startTransition(async () => {
      await addressPending.current;
      const addr = addressRef.current.payload;
      // Подсказки — не нативное поле, required браузера их не проверит.
      if (!addr) { setAddressError(A.required); focusAddress(); return; }
      // sellerName едет лишним ключом: listingFormSchema его отбросит, а
      // экшен достанет из сырого ввода и обновит users.name.
      const input = mode === "create" ? { ...v, address: addr, sellerName } : { ...v, address: addr };
      const r = mode === "create"
        ? await createListing(input)
        : await updateListing(listingId!, input);
      if (!r.ok) {
        if (ADDRESS_ERRORS.has(r.error)) { setAddressError(r.error); focusAddress(); }
        else setError(r.error);
        return;
      }
      router.push(returnHref as never);
    });
  };

  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-3">
      <StepProgress
        title={mode === "create" ? "Сдаём вещь" : "Правим объявление"}
        done={blocksDone}
        total={4}
      />

      {mode === "create" && (
        <FormBlock title="Как вас увидят покупатели" hint="имя рядом с объявлением">
          <label className="flex flex-col gap-1 text-sm">
            Имя
            <input maxLength={100} value={sellerName}
              placeholder="Например, ПрокатМастер"
              onChange={(e) => setSellerName(e.target.value)} className={INPUT} />
          </label>
        </FormBlock>
      )}

      <FormBlock title="Что сдаёте" hint="название видят в поиске">
        <label className="flex flex-col gap-1 text-sm">
          Название
          <input required minLength={3} maxLength={200} value={v.title}
            placeholder="Перфоратор Bosch GBH 2-26"
            onChange={(e) => set({ title: e.target.value })} className={INPUT} />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Категория
          <select required value={v.categoryId}
            onChange={(e) => set({ categoryId: e.target.value })} className={INPUT}>
            <option value="" disabled>Выберите категорию</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Описание
          <textarea maxLength={3000} rows={4} value={v.description}
            onChange={(e) => set({ description: e.target.value })}
            className={`${field} px-3 py-2`} />
        </label>
      </FormBlock>

      <FormBlock title="Фото" hint={`первое станет обложкой · до ${MAX_PHOTOS} штук`}>
        <PhotoDrop
          photos={v.photos}
          max={MAX_PHOTOS}
          uploading={uploading}
          error={uploadError}
          onFiles={uploadFiles}
          onRemove={(url) => set({ photos: v.photos.filter((x) => x.url !== url) })}
        />
      </FormBlock>

      <FormBlock title="Цена и залог" hint="залог возвращается арендатору">
        {/* Одно поле — обычный label, без fieldset: группировать нечего.
          * Аренда посуточная, других тарифов у брони нет. */}
        <label className="flex flex-col gap-1 text-sm">
          Цена за сутки, ₽
          <input type="number" min={1} required value={v.priceDay}
            onChange={(e) => set({ priceDay: e.target.value })} className={INPUT} />
        </label>

        <div className="flex flex-wrap gap-2">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            Залог
            <select value={v.depositType}
              onChange={(e) => set({ depositType: e.target.value as ListingFormValues["depositType"] })}
              className={INPUT}>
              <option value="money">Деньги</option>
              <option value="document">Документ</option>
              <option value="none">Без залога</option>
            </select>
          </label>
          {v.depositType === "money" && (
            <label className="flex flex-1 flex-col gap-1 text-sm">
              Сумма залога, ₽
              <input type="number" min={0} value={v.depositAmount}
                onChange={(e) => set({ depositAmount: e.target.value })} className={INPUT} />
            </label>
          )}
        </div>
      </FormBlock>

      <FormBlock title="Где забирают" hint="точный адрес не публикуем">
        <fieldset className="flex flex-col gap-1 text-sm">
          <legend className="mb-1">Способ получения (хотя бы один)</legend>
          <div className="flex flex-wrap gap-2">
            <HandoverChip
              label="Самовывоз"
              icon={<HandoverIcon pickup delivery={false} className="h-4 w-4 shrink-0" />}
              checked={v.handoverPickup}
              onChange={(checked) => set({ handoverPickup: checked })}
            />
            <HandoverChip
              label="Доставка"
              icon={<HandoverIcon pickup={false} delivery className="h-4 w-4 shrink-0" />}
              checked={v.handoverDelivery}
              onChange={(checked) => set({ handoverDelivery: checked })}
            />
          </div>
        </fieldset>

        <div className="flex flex-wrap gap-2">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            Город
            <select required value={v.cityId}
              onChange={(e) => changeCity(e.target.value)} className={INPUT}>
              <option value="" disabled>Выберите город</option>
              {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="flex w-28 flex-col gap-1 text-sm">
            Количество
            <input type="number" required min={1} max={1000} value={v.quantity}
              onChange={(e) => set({ quantity: e.target.value })} className={INPUT} />
          </label>
        </div>

        <AddressField
          city={city}
          address={address}
          error={addressError}
          onChange={changeAddress}
          track={(p) => { addressPending.current = p; }}
        />
      </FormBlock>

      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

      <Button type="submit" pending={pending} className="w-fit">
        {mode === "create" ? "Добавить позицию" : "Сохранить"}
      </Button>
    </form>
  );
}

/**
 * Адрес выдачи. В городе с геоданными — подсказки геокодера (дом, улица, ЖК,
 * посёлок) с подписью точности под полем; город и округ целиком не
 * принимаются. Без геоданных — обязательный текст, его покупатели видят как
 * есть, поэтому без номера дома. Ошибка сервера про адрес — здесь же.
 */
function AddressField({
  city, address, error, onChange, track,
}: {
  city: ListingFormCity | null;
  address: AddressState;
  error: string | null;
  /** Правка адреса от поля города `cityId`: от поля прежнего города не принимается. */
  onChange: (cityId: string, patch: Partial<AddressState>) => void;
  track: (pending: Promise<void>) => void;
}) {
  const errorId = `${ADDRESS_ID}-error`;
  const hintId = `${ADDRESS_ID}-hint`;
  const errorLine = error && (
    <p id={errorId} className="text-sm text-destructive" role="alert">{error}</p>
  );

  if (!city) {
    return (
      <label className="flex flex-col gap-1 text-sm">
        {A.label}
        <input disabled placeholder={A.cityFirst} className={`${INPUT} disabled:opacity-60`} />
      </label>
    );
  }

  if (!city.geo) {
    return (
      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor={`${ADDRESS_ID}-input`}>{A.label}</label>
        <input
          id={`${ADDRESS_ID}-input`}
          required minLength={3} maxLength={200}
          value={address.text}
          placeholder={A.textPlaceholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${hintId} ${errorId}` : hintId}
          onChange={(e) => onChange(city.id, { text: e.target.value, payload: { mode: "text", text: e.target.value } })}
          className={INPUT}
        />
        <p id={hintId} className="text-xs text-muted-foreground">{A.textHint}</p>
        {errorLine}
      </div>
    );
  }

  const legacy = !address.value && address.legacy ? A.legacy(address.legacy) : null;
  return (
    <div className="flex flex-col gap-1 text-sm">
      <AddressCombobox
        // Свой мини-индекс и свой центр у каждого города: смена города — новое поле.
        key={city.id}
        id={ADDRESS_ID}
        citySlug={city.slug}
        cityName={city.name}
        geo={city.geo}
        value={address.value}
        onPick={(hit) => onChange(city.id, { value: addressValueOf(hit, city.name), payload: pickPayload(hit) })}
        onClear={() => onChange(city.id, { value: null, payload: null })}
        mode="listing"
        label={A.label}
        labelClassName="mb-1"
        placeholder={A.placeholder}
        invalid={!!error}
        describedBy={[legacy ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined}
        track={track}
      />
      {legacy && <p id={hintId} className="text-xs text-muted-foreground">{legacy}</p>}
      {errorLine}
    </div>
  );
}
