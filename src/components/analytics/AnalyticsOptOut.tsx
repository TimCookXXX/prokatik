"use client";

import { useState, useSyncExternalStore, useTransition, type FormEvent } from "react";
import { content } from "@theme/content";
import { Button } from "@/components/ui/button";
import {
  optInToAnalytics, optInToAnalyticsForm, optOutOfAnalytics, optOutOfAnalyticsForm,
} from "@/server/actions/analytics";
import { analyticsAllowedHere } from "./allowed-here";
import { reloadDocument } from "./document-nav";

// У document.cookie нет события смены, а подписываться и не на что: после
// отказа или возврата страница перезагружается целиком.
const subscribe = () => () => {};

// Отказ от учёта на этом устройстве (/privacy). После ответа — полная
// перезагрузка: счётчик Метрики решает, подниматься ли, раз на загрузку
// документа, и уже поднятый на этой странице иначе продолжил бы писать.
//
// Это форма с Server Action, а не только кнопка: без JS она уходит обычной
// отправкой, action ставит отказ и возвращает редиректом к кнопке — следующая
// загрузка рисуется уже без счётчика и его noscript-пикселя. С JS отправку
// перехватывает onSubmit. `allowed` — что прочитал сервер в куках запроса: на
// нём рисуется первый кадр и страница без JS.
export function AnalyticsOptOut({ allowed: serverAllowed }: { allowed: boolean }) {
  const t = content.privacy.optOut;
  const allowed = useSyncExternalStore(subscribe, analyticsAllowedHere, () => serverAllowed);
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    start(async () => {
      setFailed(false);
      const res = await (allowed ? optOutOfAnalytics() : optInToAnalytics()).catch(() => null);
      if (!res?.ok) {
        setFailed(true);
        return;
      }
      reloadDocument();
    });
  };

  return (
    <form
      name="analytics_opt_out"
      action={allowed ? optOutOfAnalyticsForm : optInToAnalyticsForm}
      onSubmit={onSubmit}
      className="not-prose my-4 flex flex-col items-start gap-3 rounded-lg border border-border bg-card p-4 text-card-foreground"
    >
      <p className="text-sm leading-relaxed">{allowed ? t.statusOn : t.statusOff}</p>
      <Button
        type="submit"
        variant={allowed ? "outline" : "default"}
        pending={pending}
        className="h-auto min-h-11 whitespace-normal py-2 text-center"
      >
        {allowed ? t.optOut : t.optIn}
      </Button>
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {t.failed}
        </p>
      )}
    </form>
  );
}
