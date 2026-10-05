"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft, MessageCircle } from "lucide-react";
import { content } from "@theme/content";

// Заголовок раздела только на мобайле: там панель переписок fixed и занимает
// весь экран, перекрывая заголовок из каркаса кабинета, так что понять, где ты,
// иначе нельзя. На десктопе раздел назван подсвеченным пунктом сайдбара.
// Один на список тредов и на пустой раздел: без переписок экран иначе
// оставался без заголовка и без пути назад.
//
// aria-hidden: настоящий h1 остаётся в каркасе (там он sr-only), и второй
// заголовок с тем же текстом только мешал бы скринридеру.
export function ChatMobileHeader() {
  const router = useRouter();
  return (
    <div
      aria-hidden="true"
      data-chat-mobile-header
      className="flex shrink-0 items-center gap-2.5 px-3 pb-1 pt-3 md:hidden"
    >
      <button
        type="button"
        tabIndex={-1}
        onClick={() => router.push("/cabinet" as never)}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <MessageCircle className="h-6 w-6 shrink-0 text-accent" />
      <span className="font-display text-2xl font-bold">{content.chat.title}</span>
    </div>
  );
}
