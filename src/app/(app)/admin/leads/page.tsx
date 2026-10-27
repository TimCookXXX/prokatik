// Заявки без аккаунта — из бота и запасной формы (ADR 0028). Главное
// сравнение недели — клики против отправок; ниже признаки, что Telegram не
// доходит (черновики без привязки, очередь вебхука), недоставленные карточки
// и сам список. Статусы меняются кнопками в группе, здесь — только просмотр.

import type { Metadata } from "next";
import { content } from "@theme/content";
import { assertAdmin } from "@/lib/auth/assert-admin";
import {
  LEAD_FUNNEL_MAX_DAYS, adminLeadCounts, adminLeadHealth, adminListLeads, adminWebhookInfo,
  type LeadCounts, type LeadRow,
} from "@/server/leads";
import { formatMarkTime, formatPhone, leadRange } from "@/lib/leads/card";
import { formatPrice } from "@/lib/catalog/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Заявки без входа — админка", robots: { index: false } };

const t = content.adminLeads;
const statusLabel = content.bot.status;

// Классы бейджа статуса (токены темы), как у заявок из кабинета.
const STATUS_BADGE: Record<LeadRow["status"], string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-primary/10 text-foreground",
  handed: "bg-accent/15 text-foreground",
  taken: "bg-primary text-primary-foreground",
  declined: "bg-destructive/15 text-foreground",
};

const FUNNEL: { key: keyof LeadCounts; label: string }[] = [
  { key: "clicks", label: t.funnel.clicks },
  { key: "drafts", label: t.funnel.drafts },
  { key: "bound", label: t.funnel.bound },
  { key: "sentTelegram", label: t.funnel.sentTelegram },
  { key: "sentForm", label: t.funnel.sentForm },
  { key: "handed", label: t.funnel.handed },
  { key: "taken", label: t.funnel.taken },
  { key: "declined", label: t.funnel.declined },
];

/** Клиент строкой: @ник, иначе имя из Telegram или формы; телефон — если есть. */
function clientLine(lead: LeadRow): string {
  const who = lead.tgUsername ? `@${lead.tgUsername}` : lead.tgName ?? lead.customerName;
  return [who, lead.customerPhone ? formatPhone(lead.customerPhone) : null]
    .filter((p): p is string => !!p)
    .join(" · ") || "—";
}

/** Метки кампании строкой: источник, кампания, ключевая фраза. */
function sourceLine(utm: LeadRow["utm"]): string | null {
  if (!utm) return null;
  const parts = [utm.utm_source, utm.utm_medium, utm.utm_campaign, utm.utm_term ? `«${utm.utm_term}»` : null]
    .filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export default async function AdminLeadsPage() {
  await assertAdmin();
  const now = new Date();
  const [week, month, health, webhook, rows] = await Promise.all([
    adminLeadCounts(7, now),
    adminLeadCounts(LEAD_FUNNEL_MAX_DAYS, now),
    adminLeadHealth(now),
    adminWebhookInfo(),
    adminListLeads(),
  ]);

  return (
    <section aria-label={t.nav} className="flex flex-col gap-6">
      <section aria-labelledby="leads-funnel" className="flex flex-col gap-2">
        <h2 id="leads-funnel" className="font-display text-lg font-bold">{t.funnel.heading}</h2>
        <div className="rounded-lg border border-border bg-card">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left font-mono text-2xs text-muted-foreground">
                <th scope="col" className="px-3 py-2 font-medium">{t.funnel.metric}</th>
                <th scope="col" className="w-20 px-3 py-2 text-right font-medium">{t.funnel.days7}</th>
                <th scope="col" className="w-20 px-3 py-2 text-right font-medium">{t.funnel.days30}</th>
              </tr>
            </thead>
            <tbody>
              {FUNNEL.map(({ key, label }) => (
                <tr key={key} className="border-t border-border">
                  <th scope="row" className="px-3 py-2 text-left font-normal">{label}</th>
                  <td className="px-3 py-2 text-right font-mark font-bold tabular-nums">{week[key]}</td>
                  <td className="px-3 py-2 text-right font-mark font-bold tabular-nums">{month[key]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">{t.funnel.note}</p>
      </section>

      <section aria-labelledby="leads-health" className="flex flex-col gap-2">
        <h2 id="leads-health" className="font-display text-lg font-bold">{t.health.heading}</h2>
        {/* Охра — то, что требует внимания: черновики есть, а бот их не видит. */}
        <p
          role="status"
          className={health.unboundDrafts > 0
            ? "rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm"
            : "text-sm text-muted-foreground"}
        >
          {health.unboundDrafts > 0 ? t.health.unbound(health.unboundDrafts) : t.health.unboundNone}
        </p>
        <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
          {webhook ? (
            <>
              <p className={webhook.pendingUpdateCount > 0 ? "font-semibold text-accent" : ""}>
                {t.health.pending(webhook.pendingUpdateCount)}
              </p>
              <p className="mt-1 break-words text-muted-foreground">
                {webhook.lastErrorDate
                  ? t.health.lastError(formatMarkTime(webhook.lastErrorDate), webhook.lastErrorMessage ?? "—")
                  : t.health.noError}
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">{t.health.webhookOff}</p>
          )}
        </div>

        <h3 className="mt-2 text-sm font-semibold">{t.health.undeliveredHeading}</h3>
        {health.undelivered.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.health.undeliveredNone}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {health.undelivered.map((lead) => (
              <li key={lead.id} className="rounded-lg border border-accent/40 bg-card px-4 py-3 text-sm">
                <p className="font-medium">
                  {lead.code ?? "—"} · {lead.listingTitle ?? t.list.noListing}
                </p>
                <p className="text-muted-foreground">
                  {lead.sentAt ? formatMarkTime(lead.sentAt) : "—"}
                  {" · "}{t.health.attempts(lead.cardAttempts)}
                  {" · "}{lead.cardNextAt ? t.health.nextTry(formatMarkTime(lead.cardNextAt)) : t.health.noRetry}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="leads-list" className="flex flex-col gap-2">
        <h2 id="leads-list" className="font-display text-lg font-bold">{t.list.heading}</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.list.empty}</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{t.list.count(rows.length)}</p>
            <ul className="flex flex-col gap-2">
              {rows.map((lead) => <LeadItem key={lead.id} lead={lead} />)}
            </ul>
          </>
        )}
      </section>
    </section>
  );
}

function LeadItem({ lead }: { lead: LeadRow }) {
  const source = sourceLine(lead.utm);
  const owner = [lead.ownerName, lead.ownerPhone ? formatPhone(lead.ownerPhone) : null]
    .filter((p): p is string => !!p)
    .join(" · ") || "—";
  const mark = lead.statusChangedAt || lead.statusChangedBy
    ? [lead.statusChangedBy, lead.statusChangedAt ? formatMarkTime(lead.statusChangedAt) : null]
      .filter((p): p is string => !!p)
      .join(", ")
    : null;

  return (
    <li className="flex flex-col gap-1.5 rounded-lg border border-border bg-card px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mark font-bold">{lead.code ?? "—"}</span>
        <span className={`rounded-sm px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[lead.status]}`}>
          {statusLabel[lead.status]}
        </span>
        <span className="text-xs text-muted-foreground">
          {lead.channel === "telegram" ? t.list.telegram : t.list.form}
          {lead.sentAt ? ` · ${formatMarkTime(lead.sentAt)}` : ""}
        </span>
        {lead.internal && (
          <span className="rounded-sm bg-muted px-2 py-0.5 text-xs text-muted-foreground">{t.list.internal}</span>
        )}
        {lead.groupMessageId === null && (
          <span className="rounded-sm bg-accent/15 px-2 py-0.5 text-xs text-foreground">{content.bot.card.notDelivered}</span>
        )}
      </div>
      <p className="min-w-0 break-words font-medium">
        {lead.listingPath ? (
          <a href={lead.listingPath} className="hover:underline">{lead.listingTitle ?? lead.listingPath}</a>
        ) : (
          lead.listingTitle ?? t.list.noListing
        )}
      </p>
      <p className="text-muted-foreground">
        {leadRange(lead.dateFrom, lead.dateTo)}
        {lead.qty > 1 ? ` · ${lead.qty} шт.` : ""}
        {lead.total !== null ? ` · ≈ ${formatPrice(lead.total)}` : ""}
      </p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-muted-foreground">
        <dt>{t.list.client}</dt>
        <dd className="break-words text-foreground">{clientLine(lead)}</dd>
        <dt>{t.list.owner}</dt>
        <dd className="break-words text-foreground">{owner}</dd>
        {source && (
          <>
            <dt>{t.list.source}</dt>
            <dd className="break-words">{source}</dd>
          </>
        )}
      </dl>
      {mark && <p className="text-xs text-muted-foreground">{t.list.mark(mark)}</p>}
    </li>
  );
}
