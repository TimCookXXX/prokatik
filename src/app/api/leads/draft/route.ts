// Черновик заявки для бота (ADR 0028). Клик по «Забронировать в Telegram» —
// настоящая ссылка на t.me/<бот>?start=<token>, и в том же обработчике браузер
// шлёт сюда маяк (navigator.sendBeacon) с токеном и выбором. Бот по /start
// находит черновик по токену.
//
// Роут, а не Server Action — отступление от правила «мутации в actions»: только
// маяк переживает уход со страницы, а клик уводит человека в Telegram. Ответ
// всегда 204 без тела: маяку его некому прочитать, а подбирать по нему нечего.
//
// Провал проверки выбора — тоже строка, с invalid_reason: так бот объяснит
// причину, а не скажет «не найдено». Повтор токена — тихий успех.
//
// Кука vid этому роуту только читается: middleware его не накрывает.

import { NextResponse, after, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { checkLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/http/client-ip";
import { readBodyCapped } from "@/lib/http/read-capped";
import { SESSION_COOKIE_NAMES } from "@/lib/auth/cookie-name";
import { VISITOR_COOKIE, isVisitorId } from "@/lib/analytics/visitor-cookie";
import { parseBookingParams } from "@/lib/booking/params";
import { todayStr } from "@/lib/catalog/dates";
import { LEAD_DRAFT_BODY_MAX, cleanUtm, cleanYmClientId, leadDraftSchema } from "@/lib/leads/payload";
import { checkBookingSelection, type SelectionViewer } from "@/server/booking-check";
import { insertLeadDraft, pruneLeadDrafts, snapshotColumns, visitorContext } from "@/server/leads";
import { retryUndeliveredCards } from "@/server/lead-delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noContent = () => new NextResponse(null, { status: 204 });

interface Viewer {
  viewer: SelectionViewer;
  admin: boolean;
  banned: boolean;
}

/** Кто в аккаунте. Без куки сессии в базу не ходим: у гостя её нет. */
async function viewerOf(req: NextRequest): Promise<Viewer> {
  const hasSession = SESSION_COOKIE_NAMES.some((name) => req.cookies.has(name));
  const session = hasSession ? await auth() : null;
  const user = session?.user;
  if (!user?.id) return { viewer: null, admin: false, banned: false };
  return { viewer: { userId: user.id }, admin: user.role === "admin", banned: !!user.bannedAt };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Без бота черновик некому прочитать.
  if (!getEnv().TELEGRAM_BOT_TOKEN) return noContent();

  const body = await readBodyCapped(req, LEAD_DRAFT_BODY_MAX);
  if (body === null) return noContent();

  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return noContent();
  }
  const parsed = leadDraftSchema.safeParse(raw);
  if (!parsed.success) return noContent();
  const form = parsed.data;

  // vid нет при отказе от учёта — тогда держит только лимит по IP.
  const vidRaw = req.cookies.get(VISITOR_COOKIE)?.value;
  const visitorId = isVisitorId(vidRaw) ? vidRaw.toLowerCase() : null;
  if (visitorId && !checkLimit(visitorId, "lead_draft").ok) return noContent();
  if (!checkLimit(clientIp(req.headers), "lead_draft_ip").ok) return noContent();

  try {
    const who = await viewerOf(req);
    const check = await checkBookingSelection(form, who.viewer);
    const ctx = await visitorContext(visitorId);
    // Даты строки — после клампа: в CHECK booking_leads_dates_order и в колонку
    // date уходят только настоящие даты по порядку, даже у невалидного черновика.
    const sel = check.ok
      ? check.sel
      : parseBookingParams({ from: form.from, to: form.to, qty: String(form.qty) }, { today: todayStr(), maxQty: 1000 });
    const invalidReason = who.banned ? "banned" : check.ok ? null : check.error.slice(0, 40);
    await insertLeadDraft({
      ...snapshotColumns(check.snapshot),
      startToken: form.token,
      invalidReason,
      dateFrom: sel.from,
      dateTo: sel.to,
      qty: check.ok ? sel.qty : form.qty,
      total: check.ok ? check.total : null,
      utm: cleanUtm(form.utm) ?? ctx.utm,
      ymClientId: cleanYmClientId(form.ymClientId) ?? ctx.ymClientId,
      visitorId,
      internal: who.admin || ctx.internal,
    });
  } catch (e) {
    console.error("[leads] черновик не записан:", dbCode(e));
  }

  after(async () => {
    await pruneLeadDrafts();
    await retryUndeliveredCards();
  });
  return noContent();
}

/** Код ошибки для лога: текст запроса drizzle несёт параметры. */
function dbCode(e: unknown): string {
  const err = e as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = err?.cause?.code ?? err?.code;
  return typeof code === "string" ? code : e instanceof Error ? e.name : "unknown";
}
