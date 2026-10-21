import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";

const actions = vi.hoisted(() => ({
  optOutOfAnalytics: vi.fn(async () => ({ ok: true as const, data: undefined })),
  optInToAnalytics: vi.fn(async () => ({ ok: true as const, data: undefined })),
  optOutOfAnalyticsForm: vi.fn(async () => {}),
  optInToAnalyticsForm: vi.fn(async () => {}),
}));
vi.mock("@/server/actions/analytics", () => actions);

// Куки запроса — те же, что у документа: сервер и браузер видят один отказ.
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const pair = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
      return pair ? { value: pair.slice(name.length + 1) } : undefined;
    },
  }),
}));

const docNav = vi.hoisted(() => ({ loadDocument: vi.fn(), reloadDocument: vi.fn() }));
vi.mock("@/components/analytics/document-nav", () => docNav);

import PrivacyPage, { generateMetadata } from "@/app/(public)/privacy/page";
import { PREVIOUS_VISITORS_MAX } from "@/lib/analytics/visitor-cookie";
import { content } from "@theme/content";
import {
  BACKUP_RETENTION_DAYS, EVENT_RETENTION_DAYS, VISITOR_RETENTION_DAYS,
} from "@/lib/analytics/limits";

const t = content.privacy.optOut;

function clearOptOut() {
  document.cookie = "noanalytics=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
}

beforeEach(() => {
  actions.optOutOfAnalytics.mockClear();
  actions.optInToAnalytics.mockClear();
  docNav.reloadDocument.mockClear();
});
afterEach(clearOptOut);

describe("/privacy", () => {
  it("содержит контактный email и упоминание Метрики", async () => {
    const { container, getByText } = render(await PrivacyPage());
    expect(container.textContent).toContain(content.site.contactEmail);
    expect(container.textContent?.toLowerCase()).toMatch(/метрик/);
    expect(getByText(content.privacy.title)).toBeTruthy();
  });

  it("описание — вводный абзац, canonical абсолютный", () => {
    const metadata = generateMetadata();
    expect(metadata.description).toBe(content.privacy.intro);
    expect(metadata.alternates?.canonical).toBe(`${process.env.NEXTAUTH_URL!.replace(/\/$/, "")}/privacy`);
    expect(metadata.robots).toBeUndefined();
  });

  // Сроки в тексте — те же константы, по которым чистит код.
  it("называет сроки хранения из констант", async () => {
    const text = render(await PrivacyPage()).container.textContent ?? "";
    expect(text).toContain(`храним ${EVENT_RETENTION_DAYS}\u00a0дней`);
    expect(text).toContain(`ещё ${VISITOR_RETENTION_DAYS}\u00a0дней после последнего захода`);
    expect(text).toContain(`ещё до ${BACKUP_RETENTION_DAYS}\u00a0дней`);
  });

  it("раскрывает свои cookies и то, что IP не сохраняется", async () => {
    const text = render(await PrivacyPage()).container.textContent ?? "";
    for (const name of ["vid", "vid_prev", "noanalytics", "city", "_ym_uid"]) expect(text).toContain(name);
    expect(text).toContain("IP-адрес");
    expect(text).toContain("в базу не записывает");
    expect(text).toContain("содержимое переписки");
  });

  // Хиты Метрики идут с адресом страницы целиком (BACKLOG, «Хиты Метрики без
  // точки «Где»»): политика не обещает, что текст поиска до неё не доходит.
  it("говорит, что адрес страницы в Метрике несёт текст поиска и «Где»", async () => {
    const text = render(await PrivacyPage()).container.textContent ?? "";
    expect(text).toContain("Адрес страницы поиска и каталога содержит текст запроса");
    expect(text).not.toMatch(/события сайта без личных данных[^.]*без текста поиска/);
  });

  it("отказ обещает удалить и историю под прежними id — сколько их помнит vid_prev", async () => {
    const text = render(await PrivacyPage()).container.textContent ?? "";
    expect(text).toContain(`до ${PREVIOUS_VISITORS_MAX} прежних идентификаторов`);
  });

  it("раздел отказа — по якорю из подвала", async () => {
    const { container } = render(await PrivacyPage());
    const heading = container.querySelector("#opt-out");
    expect(heading?.textContent).toBe(content.privacy.section.optOut);
  });
});

describe("отказ от учёта на /privacy", () => {
  it("отказ: зовёт action и перезагружает страницу — Метрика должна не подняться", async () => {
    const { getByRole, getByText } = render(await PrivacyPage());
    expect(getByText(t.statusOn)).toBeTruthy();
    fireEvent.click(getByRole("button", { name: t.optOut }));
    await waitFor(() => expect(docNav.reloadDocument).toHaveBeenCalledTimes(1));
    expect(actions.optOutOfAnalytics).toHaveBeenCalledTimes(1);
    expect(actions.optInToAnalytics).not.toHaveBeenCalled();
  });

  it("отказ уже стоит: кнопка возвращает учёт", async () => {
    document.cookie = "noanalytics=1; path=/";
    const { getByRole, getByText } = render(await PrivacyPage());
    expect(getByText(t.statusOff)).toBeTruthy();
    fireEvent.click(getByRole("button", { name: t.optIn }));
    await waitFor(() => expect(docNav.reloadDocument).toHaveBeenCalledTimes(1));
    expect(actions.optInToAnalytics).toHaveBeenCalledTimes(1);
    expect(actions.optOutOfAnalytics).not.toHaveBeenCalled();
  });

  it("сбой — сообщение и без перезагрузки", async () => {
    actions.optOutOfAnalytics.mockResolvedValueOnce({ ok: false, error: "delete_failed" } as never);
    const { getByRole, findByRole } = render(await PrivacyPage());
    fireEvent.click(getByRole("button", { name: t.optOut }));
    expect((await findByRole("alert")).textContent).toBe(t.failed);
    expect(docNav.reloadDocument).not.toHaveBeenCalled();
  });

  it("сеть упала — то же сообщение", async () => {
    actions.optOutOfAnalytics.mockRejectedValueOnce(new Error("network"));
    const { getByRole, findByRole } = render(await PrivacyPage());
    fireEvent.click(getByRole("button", { name: t.optOut }));
    expect((await findByRole("alert")).textContent).toBe(t.failed);
    expect(docNav.reloadDocument).not.toHaveBeenCalled();
  });
});

// Без JS кнопка — обычная форма: первый кадр рисуется по кукам запроса, а не
// «для большинства», иначе после отказа без JS страница звала бы отказаться снова.
describe("отказ без JS", () => {
  it("сервер рисует состояние по куке запроса и форму с action", async () => {
    expect(renderToString(await PrivacyPage())).toContain(t.statusOn);
    document.cookie = "noanalytics=1; path=/";
    const html = renderToString(await PrivacyPage());
    expect(html).toContain(t.statusOff);
    expect(html).toContain(t.optIn);
    expect(html).toMatch(/<form[^>]*name="analytics_opt_out"/);
  });
});
