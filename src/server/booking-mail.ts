// Письмо о событии заявки. Единственный путь: и создание, и решения владельца,
// и отмена шлют отсюда, чтобы правила не разъехались.
//
// Уходит через after() — ПОСЛЕ ответа и вне транзакции. Иначе либо заявка
// терялась бы из-за недоступного SMTP (письмо внутри транзакции), либо форма
// висела бы до 20 секунд на его таймаутах (await после коммита). Плавающий
// промис не годится: после ответа Server Action его исполнение не
// гарантировано, after() — единственный примитив с гарантией.
//
// Ошибка отправки давится намеренно: заявка уже создана и уведомление в
// приложении уже горит, письмо здесь — дублирующий канал. sendMail сам пишет
// причину в лог.
//
// Квоты две. Своя (mail_booking) считается ПО ПОЛУЧАТЕЛЮ: общий на сервис
// бакет позволял бы циклом «создал заявку → отменил» выесть суточную квоту
// всего сервиса и заодно бомбить один ящик. Общую (mail_daily) списывает
// sendMail — провайдер считает все письма вместе, она и защищает сервис.
//
// Забаненным не шлём: подписки на письма у сервиса нет, а бан — единственный
// случай, когда аккаунт жив, но писать ему уже не о чем.

import { after } from "next/server";
import { siteUrl } from "@/lib/site-config";
import { getDb } from "@/lib/db";
import { eq } from "drizzle-orm";
import { users } from "@db/schema";
import { checkLimit } from "@/lib/rate-limit";
import { sendMail, mailTransportAvailable } from "@/lib/mail/mailer";
import { bookingEmail, type BookingMailKind } from "@/lib/mail/templates";
import { formatDayMonth } from "@/lib/catalog/dates";

export function queueBookingMail(input: {
  kind: BookingMailKind;
  recipientId: string;
  listingTitle: string;
  dateFrom: string;
  dateTo: string;
}): void {
  if (!mailTransportAvailable()) return;

  after(async () => {
    try {
      // Получатель раньше квоты: забаненный или безадресный не должен тратить
      // слот, которого потом не хватит настоящему письму.
      const rows = await getDb()
        .select({ email: users.email, bannedAt: users.bannedAt })
        .from(users)
        .where(eq(users.id, input.recipientId))
        .limit(1);
      const recipient = rows[0];
      if (!recipient?.email || recipient.bannedAt) return;

      const quota = checkLimit(input.recipientId, "mail_booking");
      if (!quota.ok) {
        // sendMail сюда не дошёл и в лог ничего не написал — пишем сами,
        // иначе пропавшие письма неотличимы от неотправлявшихся.
        console.warn(`[mail] booking mail skipped: recipient quota, kind=${input.kind}`);
        return;
      }

      const period = input.dateFrom === input.dateTo
        ? formatDayMonth(input.dateFrom)
        : `${formatDayMonth(input.dateFrom)} — ${formatDayMonth(input.dateTo)}`;
      const link = `${siteUrl()}/cabinet/requests`;

      await sendMail(bookingEmail(input.kind, recipient.email, input.listingTitle, period, link));
    } catch (e) {
      // sendMail пишет причину сетевых отказов сам, но исчерпание общей квоты
      // он бросает ДО отправки — фиксируем и его, ронять нечего: ответ ушёл.
      const reason = e instanceof Error ? e.message : String(e);
      console.warn(`[mail] booking mail failed: kind=${input.kind}: ${reason}`);
    }
  });
}
