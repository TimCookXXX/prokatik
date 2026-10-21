"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { field } from "@/components/ui/field";
import { updateProfile } from "@/server/actions/profile";
import { useCityPreference } from "@/components/layout/CityPreference";

const INPUT = `${field} h-11 px-3`;

export function ProfileForm({
  initialName, initialPhone, initialBio, initialCityId, cityGone, cities,
}: {
  initialName: string;
  initialPhone: string;
  initialBio: string;
  /** Пустая строка — город не указан. */
  initialCityId: string;
  /** У человека записан город, которого больше нет среди активных. */
  cityGone?: boolean;
  cities: readonly { id: string; name: string; slug: string }[];
}) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [bio, setBio] = useState(initialBio);
  const [cityId, setCityId] = useState(initialCityId);
  const { choose } = useCityPreference();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const r = await updateProfile({ name, phone, bio, cityId });
      if (!r.ok) { setError(r.error); return; }
      setSaved(true);
      // Шапка и таб-бар живут в корневом layout'е и от сохранения формы сами не
      // перерисуются: без этого город менялся бы на страницах, но не в шапке
      // над ними. Экшен уже записал ту же куку.
      const chosen = cities.find((c) => c.id === cityId);
      if (chosen) choose(chosen.slug);
    });
  };

  return (
    <form name="profile" onSubmit={submit} className="flex max-w-md flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        Имя
        <input required maxLength={100} value={name}
          onChange={(e) => { setName(e.target.value); setSaved(false); }} className={INPUT} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Телефон
        <input type="tel" value={phone} placeholder="+7 900 000-00-00" autoComplete="tel"
          onChange={(e) => { setPhone(e.target.value); setSaved(false); }} className={INPUT} />
        <span className="text-xs text-muted-foreground">
          Подставляется в форму заявки и показывается покупателю после подтверждения.
        </span>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Мой город
        {/* Пустой пункт выбираемый, а не disabled: без города живут все, кто
          * его не указывал, и <select> иначе показывал бы им первый город из
          * списка — а любое сохранение молча записывало бы его. */}
        <select value={cityId}
          onChange={(e) => { setCityId(e.target.value); setSaved(false); }}
          className={INPUT}>
          <option value="">Не указан</option>
          {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {/* Город человека отключили. Молча стереть его при сохранении имени
          * или телефона нельзя — надо сказать, что именно записывается. */}
        {cityGone ? (
          <span className="text-xs text-accent">
            Город, который вы указывали, больше не доступен. Сохранение запишет
            «Не указан» — выберите другой, если он есть в списке.
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            Виден в вашем публичном профиле и подставляется в новое объявление.
          </span>
        )}
      </label>
      <label className="flex flex-col gap-1 text-sm">
        О себе
        <textarea maxLength={500} rows={3} value={bio}
          onChange={(e) => { setBio(e.target.value); setSaved(false); }}
          placeholder="Пара слов для покупателей — видно в вашем профиле"
          className={`${field} px-3 py-2`} />
      </label>

      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      {saved && <p className="text-sm text-muted-foreground" role="status">Сохранено.</p>}

      <Button type="submit" pending={pending} className="w-fit">Сохранить</Button>
    </form>
  );
}
