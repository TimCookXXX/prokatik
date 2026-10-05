"use client";

// Всплывашки. Отдельным компонентом от провайдера, потому что Toaster обязан
// стоять в дереве один раз, а провайдер держит соединение — смешивать
// ответственности незачем.
//
// Цвета берутся из наших токенов, а не из палитры sonner: библиотека
// стилизуется CSS-переменными на [data-sonner-toaster], и своя тёмная тема у
// неё разъехалась бы с нашей на переключении.

import { Toaster } from "sonner";
import { WEBVISOR_PRIVATE } from "@/components/analytics/webvisor";

// Отступы от кромок экрана — с системными инсетами (viewportFit: "cover" в
// layout): иначе в веб-приложении на экране «Домой» всплывашка встаёт под
// чёлку, а у телефона на боку — под её выступ сбоку. Строки уходят в
// CSS-переменные sonner как есть, поэтому env() и max() здесь работают.
const EDGE = 16;
const inset = (side: "top" | "right" | "left") => `max(${EDGE}px, env(safe-area-inset-${side}))`;
const OFFSET = { top: inset("top"), right: inset("right"), left: inset("left"), bottom: EDGE };

export function RealtimeToaster() {
  return (
    <Toaster
      // Справа сверху на десктопе. На мобиле (до 600px) sonner растягивает
      // стопку во всю ширину и держит её у верхней кромки — нижний край с
      // таб-баром и полосой брони она не задевает. Ширину он считает как
      // 100% минус левый отступ дважды, поэтому левый и правый — одной
      // формулы: в портрете они равны.
      position="top-right"
      offset={OFFSET}
      mobileOffset={OFFSET}
      // Не трогаем richColors: цвета у нас свои, токенами.
      toastOptions={{
        classNames: {
          // Всплывашки пересказывают сообщения и заявки — Вебвизор их не пишет.
          toast: `surface !bg-card !text-foreground !border-border ${WEBVISOR_PRIVATE}`,
          title: "!font-medium",
          description: "!text-muted-foreground",
          actionButton: "!bg-accent !text-accent-foreground",
        },
      }}
    />
  );
}
