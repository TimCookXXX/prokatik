"use client";

// Запасная форма заявки без аккаунта (BOOKING_FLOW=telegram, ADR 0028): для
// тех, у кого нет Telegram. Имя и телефон, honeypot; заявка уходит в ту же
// админскую группу, что и заявки из бота. Успех — обещание связаться
// (leadReply, по времени суток) и цель booking_sent; код заявки человеку не
// показывается.

import { useRef, useState, useTransition } from "react";
import { Modal, ModalContent, ModalDescription, ModalTitle } from "@/components/ui/Modal";
import { Button } from "@/components/ui/button";
import { submitLeadForm } from "@/server/actions/lead";
import { rentalDaysCount, type BookingSelection } from "@/lib/booking/params";
import { field } from "@/components/ui/field";
import { WEBVISOR_NO_KEYS } from "@/components/analytics/webvisor";
import { reachGoal } from "@/components/analytics/goals";
import { formatDayMonth } from "@/lib/catalog/dates";
import { formatPrice } from "@/lib/catalog/format";
import { quote, type Tariff } from "@/lib/catalog/tariff";
import { content } from "@theme/content";
import { humanError } from "@/components/booking/booking-errors";
import { attribution, selectionFields } from "@/components/booking/lead-client";
import { leadReply } from "@/lib/leads/reply";
import { applyPhoneEdit, isCompletePhone } from "@/lib/booking/phone-mask";

const t = content.booking;
const f = content.booking.leadForm;

export function LeadFormDialog({
  open, onOpenChange, listingId, listingTitle, sel, tariff, minDays,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  listingId: string;
  listingTitle: string;
  sel: BookingSelection;
  tariff: Tariff;
  minDays: number;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Маска «+7 (900) 123-45-67». Значение и каретка ставятся в поле сразу: React
  // увидит в DOM то же значение и каретку не тронет. Через эффект нельзя — если
  // значение не изменилось (набрали нецифру), ре-рендера нет, и React вернёт
  // прежнее значение с кареткой в конце.
  const phoneRef = useRef<HTMLInputElement>(null);
  const onPhone = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const inputType = (e.nativeEvent as InputEvent).inputType ?? "";
    const next = applyPhoneEdit(phone, input.value, input.selectionStart ?? input.value.length, inputType);
    input.value = next.value;
    if (document.activeElement === input) input.setSelectionRange(next.caret, next.caret);
    setPhone(next.value);
    // Сбрасывается только подсказка про номер: «даты заняты» правка телефона не лечит.
    if (error === f.phoneInvalid) setError(null);
  };
  const phoneInvalid = error === f.phoneInvalid;

  const days = rentalDaysCount(sel);
  const q = quote({ ...tariff, minDays }, days, sel.qty);
  const estimate = q.ok ? q.total : null;
  const period = sel.from === sel.to
    ? formatDayMonth(sel.from)
    : `${formatDayMonth(sel.from)} — ${formatDayMonth(sel.to)}`;

  // Закрытая после успеха форма открывается чистой: вторая заявка — новая.
  const onOpen = (next: boolean) => {
    if (!next && code) {
      setCode(null);
      setError(null);
    }
    onOpenChange(next);
  };

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const website = new FormData(e.currentTarget).get("website")?.toString() ?? "";
    // Неполный номер на сервер не уходит: заявку с ним не передать прокату.
    if (!isCompletePhone(phone)) {
      setError(f.phoneInvalid);
      phoneRef.current?.focus();
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await submitLeadForm({
        ...selectionFields(listingId, sel, tariff),
        ...attribution(),
        name,
        phone,
        website,
      });
      if (r.ok) {
        reachGoal("booking_sent");
        setCode(r.data.code);
      } else setError(humanError(r.error));
    });
  };

  return (
    <Modal open={open} onOpenChange={onOpen}>
      <ModalContent className="md:max-w-md">
        {code ? (
          <>
            <ModalTitle className="font-display text-xl">{f.sentTitle}</ModalTitle>
            <ModalDescription className="mt-2 text-sm text-muted-foreground">
              {leadReply()}
            </ModalDescription>
            <Button className="mt-5 w-full" onClick={() => onOpen(false)}>{f.close}</Button>
          </>
        ) : (
          <>
            <ModalTitle className="font-display text-xl">{f.title}</ModalTitle>
            <ModalDescription className="mt-1 text-sm text-muted-foreground">
              {listingTitle}: {period}
              {sel.qty > 1 ? `, ${sel.qty} шт.` : ""}
              {estimate !== null ? ` · ≈ ${formatPrice(estimate)}` : ""}
            </ModalDescription>
            <p className="mt-3 text-sm">{f.intro}</p>

            <form name="booking_lead" onSubmit={submit} className={`mt-4 flex flex-col gap-3 ${WEBVISOR_NO_KEYS}`}>
              <label className="flex flex-col gap-1 text-sm">
                {f.name}
                <input
                  type="text" required value={name} autoComplete="given-name" maxLength={100}
                  onChange={(e) => setName(e.target.value)}
                  className={`${field} h-11 px-3`}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                {f.phone}
                <input
                  ref={phoneRef}
                  type="tel" required value={phone} autoComplete="tel" inputMode="tel"
                  onChange={onPhone}
                  placeholder={f.phonePlaceholder}
                  aria-invalid={phoneInvalid || undefined}
                  className={`${field} h-11 px-3`}
                />
              </label>
              {/* Honeypot: скрыто от людей, боты заполняют */}
              <input
                type="text" name="website" tabIndex={-1} autoComplete="off"
                className="absolute -left-[9999px] h-0 w-0 opacity-0" aria-hidden="true"
              />

              {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

              <Button type="submit" pending={pending} className="mt-1 w-full">
                {pending ? f.sending : f.submit}
              </Button>
              <p className="text-xs text-muted-foreground">
                {t.holdNote}. Оплата и залог — напрямую с прокатом, сервис платежи не проводит.
              </p>
            </form>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
