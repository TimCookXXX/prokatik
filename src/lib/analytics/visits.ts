// Визиты гостя — при чтении, таблицы visits нет. Визит — события подряд с
// паузой меньше VISIT_GAP_MINUTES. Источник визита — вход первой загрузки
// документа (pageview с `doc`): так гонка первых маяков не теряет, откуда
// человек пришёл. Визит, который начался не с загрузки документа, — вкладка
// была открыта, человек к ней вернулся.
//
// «Вернулся» — пришёл в другой календарный день по Москве, чем впервые: не
// второй визит (полчаса за обедом — уже второй), а другой день.
//
// Заявки, переписки и вещи аккаунта событиями не пишутся: админка берёт их из
// своих таблиц и ставит в тот визит этого браузера, в окно которого попало их
// время. Чего ни в одно окно не попало — сделано с другого устройства или там,
// где статистика не велась.

import { todayStr } from "@/lib/catalog/dates";
import { VISIT_GAP_MINUTES } from "./limits";
import { SOURCE_KINDS, type Source } from "./source";

export const VISIT_GAP_MS = VISIT_GAP_MINUTES * 60 * 1000;

/** «Зарегистрировался»: первый вход аккаунта не позже суток от его создания. */
export const SIGNUP_LOGIN_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Насколько вход может опередить created_at: часы app и базы — разные. */
const CLOCK_SKEW_MS = 60 * 1000;

/** Склейка: показ страницы и событие той же страницы приходят рядом. */
const MERGE_WINDOW_MS = 5 * 1000;

/** Служебные события: идут в одной пачке со страницей и визит не начинают. */
const SERVICE_TYPES = new Set(["login", "ym_client"]);

/** События, которые говорят о странице больше, чем её показ. */
const RICH_TYPES = new Set(["search", "view_listing"]);

export interface TimelineEvent {
  id: string;
  type: string;
  at: Date;
  path: string | null;
  listingId: string | null;
  /** Название объявления из базы; null — объявления нет или оно удалено. */
  listingTitle: string | null;
  q: string | null;
  total: number | null;
  props: Record<string, unknown>;
  /** Кто был в аккаунте в момент события; null — гость. */
  userId: string | null;
}

export type AccountActionKind = "request" | "chat" | "listing";

/** Шаг сделки из доменных таблиц: заявка, переписка, размещённая вещь. */
export interface AccountAction {
  kind: AccountActionKind;
  id: string;
  at: Date;
  listingTitle: string | null;
  /** Даты заявки, "YYYY-MM-DD". */
  dateFrom?: string;
  dateTo?: string;
}

export type VisitEntry =
  /** Визит начался загрузкой документа: источник — из её referrer'а и меток. */
  | { kind: "entry"; source: Source | null; campaign: string | null }
  /** Начался не с загрузки документа: вкладка была открыта. */
  | { kind: "continued" };

export type VisitItem =
  | { kind: "event"; event: TimelineEvent }
  | { kind: "action"; action: AccountAction };

export interface Visit {
  start: Date;
  /** Время последнего события визита. */
  end: Date;
  entry: VisitEntry;
  items: VisitItem[];
}

const byTime = <T extends { at: Date }>(a: T, b: T) => a.at.getTime() - b.at.getTime();

/** Источник из props первой загрузки документа; чужая форма — null. */
export function sourceOf(props: Record<string, unknown>): Source | null {
  const src = props.src as { kind?: unknown; label?: unknown } | undefined;
  if (!src || typeof src !== "object") return null;
  if (!(SOURCE_KINDS as readonly unknown[]).includes(src.kind)) return null;
  return { kind: src.kind as Source["kind"], label: typeof src.label === "string" ? src.label : "" };
}

function entryOf(events: readonly TimelineEvent[]): VisitEntry {
  const first = events.find((e) => !SERVICE_TYPES.has(e.type));
  if (!first || first.type !== "pageview" || first.props.doc !== true) return { kind: "continued" };
  const utm = first.props.utm as Record<string, unknown> | undefined;
  const campaign = utm && typeof utm.utm_campaign === "string" ? utm.utm_campaign : null;
  return { kind: "entry", source: sourceOf(first.props), campaign };
}

/**
 * Показ страницы, у которой есть событие богаче — поиск или просмотр
 * объявления той же страницы, — в ленте не повторяется. Ищется соседний
 * показ (служебные события между ними не в счёт) с тем же путём, по обе
 * стороны: трекер шлёт показ первым, но пачки могли прийти и в другом порядке.
 */
export function mergePageViews(events: readonly TimelineEvent[]): TimelineEvent[] {
  const hidden = new Set<number>();
  const neighbour = (from: number, step: 1 | -1): number => {
    for (let j = from + step; j >= 0 && j < events.length; j += step) {
      if (!SERVICE_TYPES.has(events[j].type)) return j;
    }
    return -1;
  };
  events.forEach((ev, i) => {
    if (!RICH_TYPES.has(ev.type)) return;
    for (const step of [-1, 1] as const) {
      const j = neighbour(i, step);
      if (j < 0 || hidden.has(j)) continue;
      const pv = events[j];
      if (pv.type === "pageview" && pv.path === ev.path
        && Math.abs(pv.at.getTime() - ev.at.getTime()) <= MERGE_WINDOW_MS) {
        hidden.add(j);
        return;
      }
    }
  });
  return events.filter((_, i) => !hidden.has(i));
}

/** Лента браузера → визиты, по времени. Источник считается до склейки показов. */
export function splitVisits(events: readonly TimelineEvent[], gapMs: number = VISIT_GAP_MS): Visit[] {
  const sorted = [...events].sort(byTime);
  const groups: TimelineEvent[][] = [];
  for (const ev of sorted) {
    const current = groups.at(-1);
    const last = current?.at(-1);
    if (current && last && ev.at.getTime() - last.at.getTime() < gapMs) current.push(ev);
    else groups.push([ev]);
  }
  return groups.map((group) => ({
    start: group[0].at,
    end: group[group.length - 1].at,
    entry: entryOf(group),
    items: mergePageViews(group).map((event) => ({ kind: "event" as const, event })),
  }));
}

/**
 * Шаги сделки аккаунта — в визиты, в окно которых попало их время: от начала
 * визита до паузы после его последнего события (заявка уходит Server Action'ом
 * уже после «Забронировать», и следующего события страницы может не быть).
 * Остальное — `elsewhere`.
 */
export function attachActions(
  visits: readonly Visit[],
  actions: readonly AccountAction[],
  gapMs: number = VISIT_GAP_MS,
): { visits: Visit[]; elsewhere: AccountAction[] } {
  const out = visits.map((v) => ({ ...v, items: [...v.items] }));
  const elsewhere: AccountAction[] = [];
  for (const action of [...actions].sort(byTime)) {
    const t = action.at.getTime();
    const visit = out.find((v) => t >= v.start.getTime() && t < v.end.getTime() + gapMs);
    if (!visit) {
      elsewhere.push(action);
      continue;
    }
    const at = (item: VisitItem) => (item.kind === "event" ? item.event.at : item.action.at).getTime();
    const index = visit.items.findIndex((item) => at(item) > t);
    visit.items.splice(index === -1 ? visit.items.length : index, 0, { kind: "action", action });
  }
  return { visits: out, elsewhere };
}

/** Московский календарный день момента. */
export const moscowDay = (at: Date): string => todayStr(at);

/** Пришёл ли браузер в другой день по Москве, чем впервые. */
export function isReturned(firstSeen: Date, lastSeen: Date): boolean {
  return moscowDay(firstSeen) !== moscowDay(lastSeen);
}

/** Первый вход аккаунта — это регистрация, если он не позже суток от создания аккаунта. */
export function isSignupLogin(loginAt: Date, userCreatedAt: Date): boolean {
  const d = loginAt.getTime() - userCreatedAt.getTime();
  return d >= -CLOCK_SKEW_MS && d <= SIGNUP_LOGIN_WINDOW_MS;
}
