"use server";

// Запасная форма «Имя + телефон» (ADR 0028): заявка без аккаунта для тех, у
// кого нет Telegram. Пишется сразу отправленной, с кодом, и уходит карточкой в
// ту же админскую группу, что и заявки из бота.
//
// Проверка выбора — та же, что у заявки из кабинета (checkBookingSelection),
// и коды ошибок те же: их показывает тот же humanError. При сессии — ещё
// banned и own_listing, как у createBookingRequest.

import { after } from "next/server";
import { cookies, headers } from "next/headers";
import { auth } from "@/lib/auth";
import { checkLimit, LEAD_FORM_DAILY_KEY } from "@/lib/rate-limit";
import { clientIp } from "@/lib/http/client-ip";
import { VISITOR_COOKIE, isVisitorId } from "@/lib/analytics/visitor-cookie";
import { leadCode } from "@/lib/leads/code";
import { cleanUtm, cleanYmClientId, leadFormSchema } from "@/lib/leads/payload";
import { checkBookingSelection } from "@/server/booking-check";
import { insertFormLead, snapshotColumns, visitorContext } from "@/server/leads";
import { deliverLeadCard, retryUndeliveredCards } from "@/server/lead-delivery";
import type { ActionResult } from "@/server/actions/booking";

export async function submitLeadForm(input: unknown): Promise<ActionResult<{ code: string }>> {
  const parsed = leadFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid_input" };
  }
  const form = parsed.data;

  // Honeypot: боту отвечаем правдоподобным «успехом», заявку не создаём.
  if (form.website !== "") return { ok: true, data: { code: leadCode() } };

  const jar = await cookies();
  const vidRaw = jar.get(VISITOR_COOKIE)?.value;
  const visitorId = isVisitorId(vidRaw) ? vidRaw.toLowerCase() : null;
  // vid нет при отказе от учёта — тогда держит лимит по IP. Эти два контура
  // стоят до проверки выбора: они берегут базу от долбёжки.
  for (const [subject, kind] of [
    [visitorId, "lead_form"],
    [clientIp(await headers()), "lead_form_ip"],
  ] as const) {
    if (subject === null) continue;
    const limit = checkLimit(subject, kind);
    if (!limit.ok) return { ok: false, error: `rate_limited:${limit.retryAfterSec}` };
  }

  let lead: Awaited<ReturnType<typeof insertFormLead>>;
  let deliver: boolean;
  try {
    const session = await auth();
    const user = session?.user?.id ? session.user : null;
    if (user?.bannedAt) return { ok: false, error: "banned" };

    const check = await checkBookingSelection(form, user ? { userId: user.id } : null);
    if (!check.ok) return { ok: false, error: check.error };

    // По номеру — только после успешной проверки, прямо перед записью. Смена
    // куки и IP не даёт засыпать заявками один чужой телефон, а отказы
    // проверки (даты заняты, цена сдвинулась, чужой listingId) слоты номера
    // не тратят: иначе три таких отказа запирали бы человека на сутки, а
    // чужой номер можно было бы заблокировать, не оставив ни строки.
    const phoneLimit = checkLimit(form.phone, "lead_phone");
    if (!phoneLimit.ok) return { ok: false, error: `rate_limited:${phoneLimit.retryAfterSec}` };

    const ctx = await visitorContext(visitorId);
    // Сверх суточного потолка заявка сохраняется, но в группу не идёт: поток от
    // скрипта не должен заваливать чат, где основатель работает руками.
    deliver = checkLimit(LEAD_FORM_DAILY_KEY, "lead_form_daily").ok;
    if (!deliver) console.error("[leads] суточный потолок формы: карточка не отправлена");

    lead = await insertFormLead({
      ...snapshotColumns(check.snapshot),
      dateFrom: check.sel.from,
      dateTo: check.sel.to,
      qty: check.sel.qty,
      total: check.total,
      customerName: form.name,
      customerPhone: form.phone,
      utm: cleanUtm(form.utm) ?? ctx.utm,
      ymClientId: cleanYmClientId(form.ymClientId) ?? ctx.ymClientId,
      visitorId,
      internal: user?.role === "admin" || ctx.internal,
    }, deliver);
  } catch (e) {
    // Человек без аккаунта не должен терять введённое на упавшей странице:
    // ошибка базы — текст в форме. В лог — только код: текст запроса drizzle
    // несёт параметры, то есть имя и телефон.
    console.error("[leads] заявка формы не записана:", dbCode(e));
    return { ok: false, error: "generic" };
  }

  after(async () => {
    if (deliver) await deliverLeadCard(lead.id);
    await retryUndeliveredCards();
  });
  return { ok: true, data: { code: lead.code! } };
}

/** Код ошибки базы для лога, без текста запроса. */
function dbCode(e: unknown): string {
  const err = e as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = err?.cause?.code ?? err?.code;
  return typeof code === "string" ? code : e instanceof Error ? e.name : "unknown";
}
