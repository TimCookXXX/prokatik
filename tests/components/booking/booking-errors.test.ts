// @vitest-environment node
// Коды ошибок заявки → текст. Один словарь у диалога из кабинета и у запасной
// формы без аккаунта: коды у них общие (checkBookingSelection).
import { describe, expect, it } from "vitest";
import { humanError } from "@/components/booking/booking-errors";

describe("humanError", () => {
  it.each([
    ["rate_limited:30", "Слишком много заявок. Попробуйте через 30 с."],
    ["dates_taken:2026-09-04", "Выбранные даты уже заняты — обновите страницу и выберите другие."],
    ["price_stale", "Пока форма была открыта, владелец изменил цену — обновите страницу."],
    ["min_days:7", "Минимальный срок аренды — 7 дней. Выберите даты длиннее."],
    ["listing_not_found", "Позиция больше не доступна."],
    ["banned", "Отправка заявок для вашего аккаунта закрыта."],
  ])("%s", (code, text) => {
    expect(humanError(code)).toBe(text);
  });

  it("русский текст проверки — как есть, служебный английский — общей фразой", () => {
    expect(humanError("Укажите имя")).toBe("Укажите имя");
    expect(humanError("Expected number, received nan")).toBe("Не получилось отправить заявку — обновите страницу.");
    expect(humanError("min_days:x")).toBe("Не получилось отправить заявку — обновите страницу.");
  });
});
