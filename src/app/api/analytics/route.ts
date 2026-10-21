// Сбор своей статистики посещений: пачка событий от трекера
// (src/components/analytics/track.ts). Роут, а не Server Action
// (docs/architecture.md, исключения): маяк — параллельный fire-and-forget
// POST, в том числе при уходе со страницы (fetch keepalive на pagehide), а
// actions клиент выполняет очередью и с pagehide не отправит.
//
// Ответ всегда 204 и без тела: отказ, мусор, лимит и сбой браузеру не
// различить, и подбирать по ответу нечего. До ответа — только то, от чего он
// зависит: проверки и решение, выдавать ли браузеру новый id (Set-Cookie).
// Запись — в after(), когда ответ уже ушёл; время и id событий назначены до
// него, порядок пачки сохраняется.
//
// Порядок проверок — от дешёвых к дорогим: отказ от учёта, размер тела, свой
// ли сайт прислал, бот, id браузера, лимиты, схема, подписи данных страницы.
// База и auth() — последними.

import { NextResponse, after, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { siteUrl } from "@/lib/site-config";
import { newSortableId } from "@/lib/id";
import { checkLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/http/client-ip";
import { readBodyCapped } from "@/lib/http/read-capped";
import { SESSION_COOKIE_NAMES } from "@/lib/auth/cookie-name";
import { analyticsAllowed } from "@/lib/analytics/allowed";
import { isBotUserAgent } from "@/lib/analytics/bot";
import { deviceOf } from "@/lib/analytics/device";
import { decideLink } from "@/lib/analytics/link";
import { batchSchema, type Batch } from "@/lib/analytics/payload";
import { TRACK_BODY_MAX_BYTES } from "@/lib/analytics/limits";
import { entryOf, sanitizePath, sanitizeQuery } from "@/lib/analytics/sanitize";
import { verifyPageData, type SearchPageData, type SignedPageData } from "@/lib/analytics/token";
import { classifySource, type Source } from "@/lib/analytics/source";
import { visitorEventsCap } from "@/lib/analytics/daily-cap";
import { createNoSessionCache } from "@/lib/analytics/no-session-cache";
import {
  PREVIOUS_VISITORS_COOKIE, VISITOR_COOKIE, isVisitorId, parsePreviousVisitors, previousVisitorsCookieOptions,
  visitorCookieOptions, withPreviousVisitor,
} from "@/lib/analytics/visitor-cookie";
import {
  dbErrorCode, pruneVisitorData, readVisitor, writeVisitorBatch,
  type NewVisitorEvent, type VisitorWrite,
} from "@/server/visitor-analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noContent = () => new NextResponse(null, { status: 204 });

const noSession = createNoSessionCache();

/** Событие пачки до назначения id. */
type Draft = Omit<NewVisitorEvent, "id" | "createdAt">;

/** Прислал ли запрос сам сайт: браузер не даёт странице подделать эти заголовки. */
function fromOwnSite(req: NextRequest): boolean {
  if (req.headers.get("sec-fetch-site") === "same-origin") return true;
  const origin = req.headers.get("origin");
  return origin !== null && origin === new URL(siteUrl()).origin;
}

/** Хост сайта без `www.`: referrer с него — внутренний переход. */
function siteHost(): string {
  return new URL(siteUrl()).hostname.toLowerCase().replace(/^www\./, "");
}

interface Built {
  drafts: Draft[];
  /** Источник первой загрузки документа в пачке. */
  source: Source | null;
  /** ClientID Метрики из пачки, последний. */
  cid: string | null;
}

/** Подписанные данные события; чужая подпись, срок или вид страницы — null. */
function pageData<K extends SignedPageData["k"]>(token: string, k: K): Extract<SignedPageData, { k: K }> | null {
  const data = verifyPageData(token);
  return data && data.k === k ? (data as Extract<SignedPageData, { k: K }>) : null;
}

/** Показ выдачи: q и total — колонками, остальное посчитанное — в props. */
function searchDraft(path: string, data: SearchPageData): Draft {
  return {
    type: "search",
    path,
    q: sanitizeQuery(data.q) || null,
    total: data.total,
    props: {
      matched: data.matched,
      ...(data.reason ? { reason: data.reason } : {}),
      ...(data.partial ? { partial: true, usedQuery: data.usedQuery } : {}),
      cityIds: data.cityIds,
      dates: data.dates,
      where: data.where,
      ...(data.category ? { category: data.category } : {}),
      filters: data.filters,
      sort: data.sort,
      page: data.page,
    },
  };
}

/**
 * События пачки → строки к записи. Путь и вход чистятся здесь, на сервере;
 * событие с данными страницы без валидной подписи отбрасывается.
 */
function buildEvents(batch: Batch): Built {
  const drafts: Draft[] = [];
  let source: Source | null = null;
  let cid: string | null = null;
  for (const ev of batch.events) {
    if (ev.type === "ym_client") {
      cid = ev.cid;
      continue;
    }
    const path = sanitizePath(ev.path);
    // Адрес админки или чужой — события нет.
    if (path === null) continue;
    switch (ev.type) {
      case "pageview": {
        const props: Record<string, unknown> = {};
        if (ev.doc) {
          const entry = entryOf(ev.path, ev.ref);
          const src = classifySource(entry, siteHost());
          props.doc = true;
          props.src = src;
          if (entry.ref) props.ref = entry.ref;
          if (Object.keys(entry.utm).length > 0) props.utm = entry.utm;
          source ??= src;
        }
        drafts.push({ type: "pageview", path, props });
        break;
      }
      case "search": {
        const data = pageData(ev.token, "search");
        if (data) drafts.push(searchDraft(path, data));
        break;
      }
      case "view_listing": {
        const data = pageData(ev.token, "listing");
        if (data) {
          drafts.push({ type: "view_listing", path, listingId: data.listingId, props: { dates: data.dates, where: data.where } });
        }
        break;
      }
      case "booking_click": {
        // «В аккаунте ли» — по сессии, когда она прочитана (POST ниже).
        const data = pageData(ev.token, "listing");
        if (data) drafts.push({ type: "booking_click", path, listingId: data.listingId, props: {} });
        break;
      }
    }
  }
  return { drafts, source, cid };
}

/** Кто в аккаунте. Мусорная или протухшая кука помнится, и в базу за ней не ходят. */
async function sessionUser(req: NextRequest): Promise<{ id: string; admin: boolean } | null> {
  const token = SESSION_COOKIE_NAMES.map((name) => req.cookies.get(name)?.value).find(Boolean);
  if (!token || noSession.has(token)) return null;
  const session = await auth();
  if (!session?.user?.id) {
    noSession.remember(token);
    return null;
  }
  return { id: session.user.id, admin: session.user.role === "admin" };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!analyticsAllowed((name) => req.cookies.get(name)?.value)) return noContent();

  const body = await readBodyCapped(req, TRACK_BODY_MAX_BYTES);
  if (body === null) return noContent();
  if (!fromOwnSite(req)) return noContent();

  const ua = req.headers.get("user-agent");
  if (isBotUserAgent(ua)) return noContent();

  const vid = req.cookies.get(VISITOR_COOKIE)?.value;
  if (!isVisitorId(vid)) return noContent();
  const visitorId = vid.toLowerCase();

  const ip = clientIp(req.headers);
  if (!checkLimit(ip, "track").ok || !checkLimit(visitorId, "track_vid").ok) return noContent();

  let parsed: Batch;
  try {
    const result = batchSchema.safeParse(JSON.parse(body));
    if (!result.success) return noContent();
    parsed = result.data;
  } catch {
    return noContent();
  }

  const { drafts, source, cid } = buildEvents(parsed);
  if (drafts.length === 0 && cid === null) return noContent();

  let user: { id: string; admin: boolean } | null;
  let stored: Awaited<ReturnType<typeof readVisitor>>;
  try {
    user = await sessionUser(req);
    stored = await readVisitor(visitorId);
  } catch (e) {
    console.error("[analytics] чтение не удалось:", dbErrorCode(e));
    return noContent();
  }

  const userId = user?.id ?? null;
  const admin = user?.admin ?? false;
  const decision = decideLink(stored, userId);

  // Новая строка в visitors — свой контур лимита: кука id ничего не стоит.
  const createsRow = decision.kind === "create" || decision.kind === "switch";
  if (createsRow && !checkLimit(ip, "track_new").ok) return noContent();

  const targetId = decision.kind === "switch" ? crypto.randomUUID() : visitorId;
  // Состояние «в аккаунте» началось здесь: строка заведена с сессией, гость
  // без событий связан или браузер получил id под этот аккаунт.
  const loginHere = userId !== null && decision.kind !== "keep";
  // ClientID — только у гостя и только новый: история значений идёт событиями.
  const knownCid = decision.kind === "switch" ? null : stored?.ymClientId ?? null;
  const newCid = userId === null && cid !== null && cid !== knownCid ? cid : null;

  const final: Draft[] = [
    ...(loginHere ? [{ type: "login" }] : []),
    ...drafts.map((d) => (d.type === "booking_click" ? { ...d, props: { authed: userId !== null } } : d)),
    ...(newCid ? [{ type: "ym_client", props: { cid: newCid } }] : []),
  ];
  const previousEvents: Draft[] = decision.kind === "switch" && decision.guestLogin ? [{ type: "login" }] : [];
  if (final.length + previousEvents.length === 0) return noContent();
  if (!visitorEventsCap.take(final.length + previousEvents.length)) return noContent();

  const at = new Date();
  const stamp = (d: Draft): NewVisitorEvent => ({ ...d, id: newSortableId(), createdAt: at });
  const write: VisitorWrite = {
    id: targetId,
    userId,
    at,
    device: deviceOf(ua),
    isBot: parsed.bot === true,
    // Свои заходы: аккаунт админа, а пометка переходит на новый id в обе
    // стороны — и при входе, и при выходе.
    isInternal: admin || (stored?.isInternal ?? false),
    firstSource: source,
    ymClientId: newCid,
    previous: previousEvents.length > 0
      ? { id: visitorId, markInternal: admin, events: previousEvents.map(stamp) }
      : undefined,
    events: final.map(stamp),
  };

  after(async () => {
    try {
      await writeVisitorBatch(write);
    } catch (e) {
      console.error("[analytics] запись не удалась:", dbErrorCode(e));
    }
    await pruneVisitorData();
  });

  const res = noContent();
  if (decision.kind === "switch") {
    const secure = getEnv().NEXTAUTH_URL.startsWith("https://");
    res.cookies.set(VISITOR_COOKIE, targetId, visitorCookieOptions(secure));
    // Прежний id — в браузер, а не в базу: отказ от учёта удалит и его историю.
    const previous = parsePreviousVisitors(req.cookies.get(PREVIOUS_VISITORS_COOKIE)?.value);
    res.cookies.set(PREVIOUS_VISITORS_COOKIE, withPreviousVisitor(previous, visitorId), previousVisitorsCookieOptions(secure));
  }
  return res;
}
