import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { content } from "@theme/content";
import { assertAdmin } from "@/lib/auth/assert-admin";
import { adminVisitorCard, CARD_EVENTS_MAX } from "@/server/analytics-admin";
import { adminSetVisitorInternal } from "@/server/actions/analytics-admin";
import { analyticsHref, cursorParam, parseVisitorListFilters } from "@/lib/analytics/admin-filters";
import {
  describeDevice, describeSignIn, describeSource, momentLabel, visitorLabel,
} from "@/lib/analytics/describe";
import { ActionButton } from "@/components/admin/ActionButton";
import { CopyValue } from "@/components/admin/analytics/CopyValue";
import { VisitorBadges } from "@/components/admin/analytics/VisitorBadges";
import { VisitorTimeline } from "@/components/admin/analytics/VisitorTimeline";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Гость — админка", robots: { index: false } };

const t = content.adminAnalytics.visitor;

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-2xs uppercase tracking-mono text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm">{children}</dd>
    </div>
  );
}

export default async function AdminVisitorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await assertAdmin();
  const { id } = await params;
  const card = await adminVisitorCard(id);
  if (!card) notFound();
  // Назад — на ту же страницу списка: период, фильтр и курсор пришли сюда
  // параметрами списка; адрес собирается заново из разобранных zod'ом фильтров.
  const list = parseVisitorListFilters(await searchParams);
  const backHref = analyticsHref("/admin/visitors", {
    period: list.period, all: list.all, user: list.user, find: list.findText || undefined,
    ...(list.cursor ? { [list.cursor.dir]: cursorParam(list.cursor.at, list.cursor.id) } : {}),
  }) as Route;

  const now = new Date();
  const { visitor, user } = card;

  return (
    <section aria-label={visitorLabel({ id: visitor.id, userName: user?.name, userEmail: user?.email })} className="flex flex-col gap-4">
      <Link href={backHref} className="text-sm text-muted-foreground underline underline-offset-2 hoverable hover:text-foreground">
        {t.back}
      </Link>

      <header className="flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="min-w-0 break-words font-display text-xl font-bold">
            {visitorLabel({ id: visitor.id, userName: user?.name, userEmail: user?.email })}
          </h2>
          <VisitorBadges v={{ ...visitor, userId: user?.id ?? null }} now={now} />
        </div>
        <code className="break-all font-mono text-xs text-muted-foreground">{visitor.id}</code>

        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Fact label={t.firstSeen}>{momentLabel(visitor.firstSeenAt, now)}</Fact>
          <Fact label={t.lastSeen}>{momentLabel(visitor.lastSeenAt, now)}</Fact>
          <Fact label={t.days}>{visitor.days}</Fact>
          <Fact label={t.firstSource}>{describeSource(visitor.firstSource)}</Fact>
          <Fact label={t.device}>{describeDevice(visitor.device)}</Fact>
          {user ? (
            <>
              <Fact label={t.account}>
                {user.name ? `${user.name} · ` : ""}{user.email}
              </Fact>
              <Fact label={t.signIn}>{describeSignIn(user.providers, user.hasPassword) || "—"}</Fact>
              <Fact label={t.registered}>{momentLabel(user.createdAt, now)}</Fact>
              {user.otherDevices > 0 && (
                <Fact label={t.devices}>
                  <Link
                    href={analyticsHref("/admin/visitors", { user: user.id }) as Route}
                    className="underline underline-offset-2 hoverable hover:text-foreground"
                  >
                    {user.otherDevices + 1}
                  </Link>
                </Fact>
              )}
              <Fact label={t.clientId}>{t.clientIdAccount}</Fact>
            </>
          ) : (
            <Fact label={t.clientId}>
              {visitor.ymClientId ? <CopyValue value={visitor.ymClientId} /> : t.clientIdNone}
            </Fact>
          )}
        </dl>
        {!user && <p className="text-xs text-muted-foreground">{t.clientIdHint}</p>}

        {visitor.isBot && <p className="text-sm text-muted-foreground">{t.botNote}</p>}
        <div className="flex flex-col items-start gap-1">
          {visitor.isInternal ? (
            <>
              <p className="text-sm text-muted-foreground">{t.hiddenNote}</p>
              <ActionButton label={t.unhide} action={adminSetVisitorInternal.bind(null, visitor.id, false)} />
            </>
          ) : (
            <>
              <ActionButton label={t.hide} action={adminSetVisitorInternal.bind(null, visitor.id, true)} />
              <p className="text-xs text-muted-foreground">{t.hideHint}</p>
            </>
          )}
        </div>
      </header>

      <section aria-labelledby="timeline" className="flex flex-col gap-2">
        <h2 id="timeline" className="font-display text-lg font-bold">{t.timeline}</h2>
        {card.truncated && <p className="text-xs text-muted-foreground">{t.truncated(String(CARD_EVENTS_MAX))}</p>}
        <VisitorTimeline card={card} now={now} />
      </section>
    </section>
  );
}
