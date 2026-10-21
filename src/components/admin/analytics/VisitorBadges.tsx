// Бейджи гостя: «новый», «один день» или «вернулся» (visitorBadge — по первому
// заходу человека, а не одной строки браузера), «аккаунт», и пометки, из-за
// которых гость не попадает в сводку: «бот», «свой».

import { content } from "@theme/content";
import { visitorBadge } from "@/lib/analytics/visits";

const t = content.adminAnalytics.visitor.badges;

const BADGE = "rounded-sm px-2 py-0.5 text-xs";

export function VisitorBadges({ v, now }: {
  v: {
    personFirstSeenAt: Date; lastSeenAt: Date; continued: boolean;
    userId: string | null; isBot: boolean; isInternal: boolean;
  };
  now: Date;
}) {
  // Аккаунт после выхода не продолжается: «продолжение» — только у гостя.
  const badge = visitorBadge({
    firstSeenAt: v.personFirstSeenAt, lastSeenAt: v.lastSeenAt, continued: v.continued && v.userId === null,
  }, now);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {badge === "returned" && <span className={`${BADGE} bg-primary/10 text-primary`}>{t.returned}</span>}
      {badge === "new" && <span className={`${BADGE} bg-muted text-muted-foreground`}>{t.new}</span>}
      {badge === "oneDay" && <span className={`${BADGE} bg-muted text-muted-foreground`}>{t.oneDay}</span>}
      {v.userId && <span className={`${BADGE} bg-accent/10 text-accent`}>{t.account}</span>}
      {v.isBot && <span className={`${BADGE} bg-destructive/15`}>{t.bot}</span>}
      {v.isInternal && <span className={`${BADGE} bg-muted text-muted-foreground`}>{t.internal}</span>}
    </span>
  );
}
