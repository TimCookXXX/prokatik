"use client";

import Link from "next/link";
import { reachGoal } from "@/components/analytics/goals";

// Чип «Часто ищут» под поиском на главной — тоже поиск. Цель `search` та же,
// что у таких же чипов на экране поиска телефона: тот отправляет их панелью
// как набранный текст (MobileSearchScreen → use-search-panel), отсюда и
// kind `text`. Иначе верх воронки зависел бы от того, каким набором чипов
// человек воспользовался.
export function PopularQueryLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href as never} className={className} onClick={() => reachGoal("search", { kind: "text" })}>
      {children}
    </Link>
  );
}
