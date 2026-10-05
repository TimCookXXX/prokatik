"use client";

// Форма заявки на бронь (для авторизованного): телефон (обязателен,
// предзаполняется из профиля после первой заявки), комментарий, honeypot.
// Успех — подтверждение со ссылкой в «Мои заявки»; сервис подсказывает,
// что владелец созвонится для подтверждения.

import { useState, useTransition } from "react";
import { Modal, ModalContent, ModalDescription, ModalTitle } from "@/components/ui/Modal";
import Link from "next/link";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createBookingRequest } from "@/server/actions/booking";
import type { BookingSelection } from "@/lib/booking/params";
import { rentalDaysCount } from "@/lib/booking/params";
import { field } from "@/components/ui/field";
import { WEBVISOR_NO_KEYS } from "@/components/analytics/webvisor";
import { formatDayMonth } from "@/lib/catalog/dates";
import { formatPrice } from "@/lib/catalog/format";

function humanError(code: string): string {
  if (code.startsWith("rate_limited:")) {
    return `Слишком много заявок. Попробуйте через ${code.split(":")[1]} с.`;
  }
  if (code.startsWith("dates_taken:")) {
    return "Выбранные даты уже заняты — обновите страницу и выберите другие.";
  }
  if (code === "duplicate_request") {
    return "Вы уже отправили заявку на эти даты — она ждёт ответа в «Мои заявки».";
  }
  if (code === "qty_stale") {
    return "Пока форма была открыта, у вещи изменилось количество — обновите страницу.";
  }
  if (code === "price_stale") {
    return "Пока форма была открыта, владелец изменил цену — обновите страницу.";
  }
  if (code === "dates_stale") {
    return "Пока форма была открыта, начался новый день — обновите страницу и выберите даты заново.";
  }
  if (code === "listing_not_found") return "Позиция больше не доступна.";
  // Из интерфейса недостижимо — владельцу виджет брони не предлагает. Текст
  // нужен для прямого вызова экшена: по сети он доступен мимо UI.
  if (code === "own_listing") return "Это ваше объявление — забронировать его нельзя.";
  if (code === "auth_required") return "Войдите, чтобы отправить заявку.";
  /* Наружу выносим только то, что писали для человека. Сообщения зода на
   * английском («Expected number, received nan») сюда доезжали дословно:
   * экшен отдаёт текст первой непройденной проверки, и среди них есть как
   * наши русские, так и служебные. Кириллица — признак «это писали людям». */
  return /[а-яё]/i.test(code) ? code : "Не получилось отправить заявку — обновите страницу.";
}

export function BookingFormDialog({
  open, onOpenChange, listingId, listingTitle, sel, priceDay, initialPhone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  listingId: string;
  listingTitle: string;
  sel: BookingSelection;
  priceDay: number;
  initialPhone: string;
}) {
  const [phone, setPhone] = useState(initialPhone);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const days = rentalDaysCount(sel);
  const estimate = priceDay * days * sel.qty;
  const period = sel.from === sel.to
    ? formatDayMonth(sel.from)
    : `${formatDayMonth(sel.from)} — ${formatDayMonth(sel.to)}`;

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const website = new FormData(e.currentTarget).get("website")?.toString() ?? "";
    setError(null);
    startTransition(async () => {
      const r = await createBookingRequest({
        listingId,
        from: sel.from,
        to: sel.to,
        qty: String(sel.qty),
        priceDay: String(priceDay),
        phone,
        comment,
        website,
      });
      if (r.ok) setDone(true);
      else setError(humanError(r.error));
    });
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="md:max-w-md">
          {done ? (
            <>
              <ModalTitle className="font-display text-xl">Заявка отправлена</ModalTitle>
              <ModalDescription className="mt-2 text-sm text-muted-foreground">
                Владелец получил заявку и обычно созванивается для
                подтверждения. Если ответа нет 24 часа, заявка истечёт автоматически.
              </ModalDescription>
              <Button asChild className="mt-5 w-full">
                <Link href={"/cabinet/requests?role=customer" as never}>Мои заявки</Link>
              </Button>
            </>
          ) : (
            <>
              <ModalTitle className="font-display text-xl">Заявка на бронь</ModalTitle>
              <ModalDescription className="mt-1 text-sm text-muted-foreground">
                {listingTitle}: {period}
                {sel.qty > 1 ? `, ${sel.qty} шт.` : ""}
                {estimate !== null ? ` · ≈ ${formatPrice(estimate)}` : ""}
              </ModalDescription>

              <form onSubmit={submit} className={`mt-5 flex flex-col gap-3 ${WEBVISOR_NO_KEYS}`}>
                <label className="flex flex-col gap-1 text-sm">
                  Телефон для связи
                  <input
                    type="tel" required value={phone} autoComplete="tel"
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+7 900 000-00-00"
                    className={`${field} h-11 px-3`}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Комментарий (необязательно)
                  <textarea
                    value={comment} maxLength={500} rows={3}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Например: нужен к 9 утра"
                    className={`${field} px-3 py-2`}
                  />
                </label>
                {/* Honeypot: скрыто от людей, боты заполняют */}
                <input
                  type="text" name="website" tabIndex={-1} autoComplete="off"
                  className="absolute -left-[9999px] h-0 w-0 opacity-0" aria-hidden="true"
                />

                {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

                <Button type="submit" pending={pending} className="mt-1 w-full">
                  Отправить заявку
                </Button>
                <p className="text-xs text-muted-foreground">
                  Оплата и залог — напрямую с владельцем, сервис платежи не проводит.
                </p>
              </form>
            </>
          )}

      </ModalContent>
    </Modal>
  );
}
