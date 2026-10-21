// Бейджи гостя: «новый» или «вернулся» (другой день по Москве, чем впервые),
// «аккаунт», и пометки, из-за которых гость не попадает в сводку: «бот»,
// «свой».

import { content } from "@theme/content";
import { isReturned } from "@/lib/analytics/visits";

const t = content.adminAnalytics.visitor.badges;

const BADGE = "rounded-sm px-2 py-0.5 text-xs";

export function VisitorBadges({ v }: {
  v: { firstSeenAt: Date; lastSeenAt: Date; userId: string | null; isBot: boolean; isInternal: boolean };
}) {
  const returned = isReturned(v.firstSeenAt, v.lastSeenAt);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {returned
        ? <span className={`${BADGE} bg-primary/10 text-primary`}>{t.returned}</span>
        : <span className={`${BADGE} bg-muted text-muted-foreground`}>{t.new}</span>}
      {v.userId && <span className={`${BADGE} bg-accent/10 text-accent`}>{t.account}</span>}
      {v.isBot && <span className={`${BADGE} bg-destructive/15`}>{t.bot}</span>}
      {v.isInternal && <span className={`${BADGE} bg-muted text-muted-foreground`}>{t.internal}</span>}
    </span>
  );
}
