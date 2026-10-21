// Лента гостя по визитам, по порядку: заголовок визита — когда, откуда,
// с какого устройства; внутри — фразы событий и шаги сделки аккаунта
// (заявка, переписка, вещь), попавшие в окно визита. Шаги, не попавшие ни в
// один визит, — отдельным блоком ниже.

import { content } from "@theme/content";
import {
  clockLabel, describeAction, describeEvent, describeSignIn, describeVisit, momentLabel, searchShape,
  type SearchShape,
} from "@/lib/analytics/describe";
import { attachActions, splitVisits, type VisitItem } from "@/lib/analytics/visits";
import type { VisitorCard } from "@/server/analytics-admin";

const t = content.adminAnalytics.visitor;

function Item({ item, phrase }: { item: VisitItem; phrase: string }) {
  const at = item.kind === "event" ? item.event.at : item.action.at;
  const service = item.kind === "event" && item.event.type === "ym_client";
  return (
    <li className="flex gap-3 py-1 text-sm">
      <time dateTime={at.toISOString()} className="w-11 shrink-0 tabular-nums text-muted-foreground">
        {clockLabel(at)}
      </time>
      <span className={`min-w-0 break-words ${item.kind === "action" ? "font-medium text-primary" : ""} ${service ? "text-muted-foreground" : ""}`}>
        {phrase}
      </span>
    </li>
  );
}

export function VisitorTimeline({ card, now }: { card: VisitorCard; now: Date }) {
  // Лента с начала строки — её первый визит продолжает вход или выход.
  const rowStart = card.truncated ? null : card.visitor.firstSource;
  const { visits, elsewhere } = attachActions(splitVisits(card.events, undefined, rowStart), card.actions);
  const signupMethod = card.user ? describeSignIn(card.user.providers, card.user.hasPassword) : "";

  return (
    <div className="flex flex-col gap-3">
      {visits.length === 0 && <p className="text-sm text-muted-foreground">{t.empty}</p>}
      <ol className="flex flex-col gap-3">
        {visits.map((visit) => {
          let previousListingId: string | null = null;
          let previousSearch: SearchShape | null = null;
          return (
            <li key={visit.start.toISOString()} className="rounded-lg border border-border bg-card">
              <h3 className="border-b border-border px-4 py-2.5 text-sm font-medium">
                {describeVisit(visit.start, visit.entry, card.visitor.device, now)}
              </h3>
              <ul className="px-4 py-2">
                {visit.items.map((item) => {
                  let phrase: string;
                  if (item.kind === "action") {
                    phrase = describeAction(item.action);
                  } else {
                    const ev = item.event;
                    phrase = describeEvent(ev, card.directory, {
                      signup: ev.id === card.signupLoginId ? signupMethod : undefined,
                      previousListingId,
                      previousSearch,
                    });
                    if (ev.type !== "ym_client" && ev.type !== "login") previousListingId = ev.listingId;
                    if (ev.type === "search") previousSearch = searchShape(ev);
                  }
                  const key = item.kind === "event" ? item.event.id : `${item.action.kind}-${item.action.id}`;
                  return <Item key={key} item={item} phrase={phrase} />;
                })}
              </ul>
            </li>
          );
        })}
      </ol>

      {elsewhere.length > 0 && (
        <section aria-labelledby="elsewhere" className="rounded-lg border border-dashed border-border px-4 py-3">
          <h3 id="elsewhere" className="text-sm font-medium">{t.elsewhere}</h3>
          <p className="mb-1 text-xs text-muted-foreground">{t.elsewhereNote}</p>
          <ul>
            {elsewhere.map((action) => (
              <li key={`${action.kind}-${action.id}`} className="flex gap-3 py-1 text-sm">
                <time dateTime={action.at.toISOString()} className="shrink-0 tabular-nums text-muted-foreground">
                  {momentLabel(action.at, now)}
                </time>
                <span className="min-w-0 break-words">{describeAction(action)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
