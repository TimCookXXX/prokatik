"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { content } from "@theme/content";
import { Button } from "@/components/ui/button";
import { optInToAnalytics, optOutOfAnalytics } from "@/server/actions/analytics";
import { analyticsAllowedHere } from "./allowed-here";
import { reloadDocument } from "./document-nav";

// У document.cookie нет события смены, а подписываться и не на что: после
// отказа или возврата страница перезагружается целиком.
const subscribe = () => () => {};
// На сервере кук браузера нет: страница статична и рисуется для большинства —
// тех, кто не отказывался. После гидрации React сверит снимок с document.cookie
// и перерисует кнопку, если отказ уже стоит.
const serverSnapshot = () => true;

// Отказ от учёта на этом устройстве (/privacy). После ответа — полная
// перезагрузка: счётчик Метрики решает, подниматься ли, раз на загрузку
// документа, и уже поднятый на этой странице иначе продолжил бы писать.
export function AnalyticsOptOut() {
  const t = content.privacy.optOut;
  const allowed = useSyncExternalStore(subscribe, analyticsAllowedHere, serverSnapshot);
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);

  const run = () => start(async () => {
    setFailed(false);
    const res = await (allowed ? optOutOfAnalytics() : optInToAnalytics()).catch(() => null);
    if (!res?.ok) {
      setFailed(true);
      return;
    }
    reloadDocument();
  });

  return (
    <div className="not-prose my-4 flex flex-col items-start gap-3 rounded-lg border border-border bg-card p-4 text-card-foreground">
      <p className="text-sm leading-relaxed">{allowed ? t.statusOn : t.statusOff}</p>
      <Button
        type="button"
        variant={allowed ? "outline" : "default"}
        pending={pending}
        onClick={run}
        className="h-auto min-h-11 whitespace-normal py-2 text-center"
      >
        {allowed ? t.optOut : t.optIn}
      </Button>
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {t.failed}
        </p>
      )}
    </div>
  );
}
