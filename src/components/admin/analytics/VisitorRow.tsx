// Гость в списке: кто (имя аккаунта или «Гость 7F3K»), бейджи, первый и
// последний заход, в сколько разных дней приходил, откуда пришёл впервые,
// устройство, сколько поисков и просмотров. Вся карточка — ссылка на ленту.

import Link from "next/link";
import type { Route } from "next";
import { content } from "@theme/content";
import { countLabel, describeDevice, describeSource, momentLabel, visitorLabel } from "@/lib/analytics/describe";
import type { VisitorListRow } from "@/server/analytics-admin";
import { VisitorBadges } from "./VisitorBadges";

const t = content.adminAnalytics.list;

export function VisitorRow({ row, now }: { row: VisitorListRow; now: Date }) {
  return (
    <li>
      <Link
        href={`/admin/visitors/${row.id}` as Route}
        className="flex flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3 hoverable"
      >
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 break-words font-medium">{visitorLabel(row)}</span>
          <VisitorBadges v={row} />
        </span>
        <span className="text-sm text-muted-foreground">
          {t.firstSeen} {momentLabel(row.firstSeenAt, now)} · {t.lastSeen} {momentLabel(row.lastSeenAt, now)}
          {row.days > 1 && <> · {t.cameDays(String(row.days))}</>}
        </span>
        <span className="text-sm text-muted-foreground">
          {describeSource(row.firstSource)} · {describeDevice(row.device)}
          {" · "}{countLabel(row.searches, t.searches)} · {countLabel(row.views, t.views)}
        </span>
      </Link>
    </li>
  );
}
