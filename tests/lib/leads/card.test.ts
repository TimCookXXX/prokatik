import { describe, it, expect } from "vitest";
import {
  escapeHtml, formatMarkTime, formatPhone, leadAcceptedText, leadCardText, leadDates, leadReasonText,
  leadSummaryText, utmLine, type LeadText,
} from "@/lib/leads/card";

const SITE = "https://inrenta.example";
const NBSP = / /g;

const lead: LeadText = {
  code: "INR-4821",
  status: "sent",
  channel: "telegram",
  internal: false,
  listingTitle: "Kugoo Kirin V3 Pro, АКБ 21 Ач",
  listingPath: "/krasnodar/velo/kugoo-01JBQ0000000000000000000AB",
  ownerName: "ПикаВел",
  ownerPhone: "+79282218754",
  dateFrom: "2026-10-28",
  dateTo: "2026-11-03",
  qty: 1,
  priceDay: 500,
  priceWeek: 2250,
  priceMonth: null,
  depositType: "none",
  depositAmount: null,
  total: 2250,
  customerName: null,
  customerPhone: "+79000000000",
  tgUsername: "ivan_courier",
  tgName: "Иван",
  utm: { utm_source: "yandex", utm_medium: "cpc", utm_campaign: "velo", utm_term: "ключевая фраза" },
  statusChangedAt: null,
  statusChangedBy: null,
};

const plain = (s: string) => s.replace(NBSP, " ");

describe("карточка в группе", () => {
  it("формат, согласованный с владельцем", () => {
    expect(plain(leadCardText(lead, SITE))).toBe([
      "<b>INR-4821</b> · новая",
      `🚲 <a href="${SITE}/krasnodar/velo/kugoo-01JBQ0000000000000000000AB">Kugoo Kirin V3 Pro, АКБ 21 Ач</a>`,
      "🏪 ПикаВел · +7 928 221-87-54",
      "📅 28.10 – 03.11 (7 дней)",
      "💰 ≈ 2 250 ₽ · без залога",
      "👤 Иван · @ivan_courier · +7 900 000-00-00",
      "📨 через Telegram",
      "📈 Директ · velo · «ключевая фраза»",
    ].join("\n"));
  });

  it("экранирует всё, что пришло извне", () => {
    const text = leadCardText({
      ...lead,
      listingTitle: `Дрель <b>"Bosch"</b> & Co`,
      ownerName: "<i>Прокат</i>",
      tgName: "<a href='x'>Ваня</a>",
      tgUsername: null,
      utm: { utm_source: "<script>", utm_campaign: "a&b" },
    }, SITE);
    expect(text).toContain("Дрель &lt;b&gt;&quot;Bosch&quot;&lt;/b&gt; &amp; Co</a>");
    expect(text).toContain("🏪 &lt;i&gt;Прокат&lt;/i&gt;");
    expect(text).toContain("👤 &lt;a href='x'&gt;Ваня&lt;/a&gt;");
    expect(text).toContain("📈 &lt;script&gt; · a&amp;b");
    expect(text).not.toMatch(/<(?!\/?(b|a)[ >])/);
  });

  it("ссылка с кавычкой в пути не ломает атрибут", () => {
    expect(leadCardText({ ...lead, listingPath: `/x"onclick="y` }, SITE)).toContain(`href="${SITE}/x&quot;onclick=&quot;y"`);
  });

  it("форма: имя и телефон, без username и без меток", () => {
    const text = plain(leadCardText({
      ...lead, channel: "form", customerName: "Пётр", tgName: null, tgUsername: null,
      customerPhone: "+79001112233", utm: null,
    }, SITE));
    expect(text).toContain("👤 Пётр · +7 900 111-22-33");
    expect(text).toContain("📨 через форму");
    expect(text).not.toContain("📈");
  });

  it("Telegram без username: имя и номер", () => {
    expect(plain(leadCardText({ ...lead, tgUsername: null }, SITE))).toContain("👤 Иван · +7 900 000-00-00");
  });

  it("пустые метки — строки источника нет", () => {
    expect(leadCardText({ ...lead, utm: {} }, SITE)).not.toContain("📈");
    expect(utmLine({ utm_source: "telegram_post" })).toBe("telegram_post");
  });

  it("прокат без телефона — только имя; без имени и телефона — строки нет", () => {
    expect(leadCardText({ ...lead, ownerPhone: null }, SITE)).toContain("🏪 ПикаВел\n");
    expect(leadCardText({ ...lead, ownerPhone: null, ownerName: null }, SITE)).not.toContain("🏪");
  });

  it("строка отметки после нажатия и статус в шапке", () => {
    const text = leadCardText({
      ...lead, status: "handed", statusChangedBy: "Тимур", statusChangedAt: new Date("2026-10-27T11:05:00Z"),
    }, SITE);
    expect(text.startsWith("<b>INR-4821</b> · передана прокату")).toBe(true);
    expect(text.endsWith("✅ Передал прокату — Тимур, 27.10 14:05")).toBe(true);
    expect(leadCardText({ ...lead, status: "declined", statusChangedBy: "Т", statusChangedAt: null }, SITE))
      .toContain("❌ Отказ — Т");
  });

  it("тестовая заявка помечена в шапке", () => {
    expect(leadCardText({ ...lead, internal: true }, SITE).split("\n")[0]).toBe("<b>INR-4821</b> · новая · тестовая");
  });

  it("сумма не сохранена — считается по тарифам снимка; количество в строке дат", () => {
    const text = plain(leadCardText({ ...lead, total: null, qty: 2, depositType: "money", depositAmount: 3000 }, SITE));
    expect(text).toContain("📅 28.10 – 03.11 (7 дней) · 2 шт.");
    expect(text).toContain("💰 ≈ 4 500 ₽ · залог 3 000 ₽");
  });

  it("объявление без пути — название без ссылки", () => {
    expect(leadCardText({ ...lead, listingPath: null }, SITE)).toContain("🚲 Kugoo Kirin V3 Pro, АКБ 21 Ач\n");
  });
});

describe("тексты клиенту", () => {
  it("сводка: с username — подсказка про кнопку, без — про номер", () => {
    const withUser = plain(leadSummaryText(lead, SITE, true));
    expect(withUser).toContain("Прокат: ПикаВел");
    expect(withUser).toContain("📅 28.10 – 03.11 (7 дней)");
    expect(withUser).toContain("≈ 2 250 ₽ · без залога");
    expect(withUser).toContain("Даты закрепятся после подтверждения проката.");
    expect(withUser).toContain("Нажмите «Отправить заявку»");
    // Телефон проката клиенту не показывается.
    expect(withUser).not.toContain("928");
    expect(leadSummaryText(lead, SITE, false)).toContain("без номера прокат не сможет");
  });

  it("принята: модель, даты и обещание по времени суток, без кода", () => {
    // 12:00 и 23:00 по Москве (UTC+3).
    const noon = new Date("2026-10-28T09:00:00Z");
    const night = new Date("2026-10-28T20:00:00Z");
    expect(leadAcceptedText(lead, noon)).toBe(
      "<b>✅ Заявка принята</b>\nKugoo Kirin V3 Pro, АКБ 21 Ач · 28.10 – 03.11\n\nОжидайте — в течение 5 минут мы свяжемся с вами.",
    );
    expect(leadAcceptedText(lead, night)).toContain("Прокаты спят 😴 После 9:00 свяжемся с вами.");
    expect(leadAcceptedText(lead, noon)).not.toContain("INR");
    expect(leadAcceptedText({ ...lead, listingTitle: "a<b>", dateTo: "2026-10-28" }, noon)).toContain("a&lt;b&gt; · 28.10");
  });

  it("причины по кодам ошибок", () => {
    expect(leadReasonText("dates_taken:2026-10-28,2026-10-29")).toContain("заняты");
    expect(leadReasonText("min_days:3")).toBe("Минимальный срок аренды — 3 дня. Выберите даты длиннее на сайте.");
    expect(leadReasonText("price_stale")).toContain("цену");
    expect(leadReasonText("listing_not_found")).toContain("недоступна");
    expect(leadReasonText("own_listing")).toContain("ваше объявление");
    expect(leadReasonText("rate_limited:30")).toContain("позже");
    expect(leadReasonText("что-то новое")).toContain("не получилось");
  });
});

describe("хелперы", () => {
  it("formatPhone: российский номер по группам, остальные как есть", () => {
    expect(formatPhone("+79282218754")).toBe("+7 928 221-87-54");
    expect(formatPhone("+375291234567")).toBe("+375291234567");
  });

  it("formatMarkTime — в деловой зоне", () => {
    expect(formatMarkTime(new Date("2026-10-27T21:30:00Z"))).toBe("28.10 00:30");
  });

  it("leadDates: один день", () => {
    expect(leadDates({ dateFrom: "2026-10-28", dateTo: "2026-10-28", qty: 1 })).toBe("28.10 (1 день)");
  });

  it("escapeHtml", () => {
    expect(escapeHtml(`<&>"`)).toBe("&lt;&amp;&gt;&quot;");
  });
});
