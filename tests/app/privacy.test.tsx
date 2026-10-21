import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";

const actions = vi.hoisted(() => ({
  optOutOfAnalytics: vi.fn(async () => ({ ok: true as const, data: undefined })),
  optInToAnalytics: vi.fn(async () => ({ ok: true as const, data: undefined })),
}));
vi.mock("@/server/actions/analytics", () => actions);

const docNav = vi.hoisted(() => ({ loadDocument: vi.fn(), reloadDocument: vi.fn() }));
vi.mock("@/components/analytics/document-nav", () => docNav);

import PrivacyPage, { generateMetadata } from "@/app/(public)/privacy/page";
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
  it("содержит контактный email и упоминание Метрики", () => {
    const { container, getByText } = render(<PrivacyPage />);
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
  it("называет сроки хранения из констант", () => {
    const text = render(<PrivacyPage />).container.textContent ?? "";
    expect(text).toContain(`храним ${EVENT_RETENTION_DAYS}\u00a0дней`);
    expect(text).toContain(`ещё ${VISITOR_RETENTION_DAYS}\u00a0дней после последнего захода`);
    expect(text).toContain(`ещё до ${BACKUP_RETENTION_DAYS}\u00a0дней`);
  });

  it("раскрывает свои cookies и то, что IP не сохраняется", () => {
    const text = render(<PrivacyPage />).container.textContent ?? "";
    for (const name of ["vid", "noanalytics", "city", "_ym_uid"]) expect(text).toContain(name);
    expect(text).toContain("IP-адрес");
    expect(text).toContain("в базу не записывает");
    expect(text).toContain("содержимое переписки");
  });

  it("раздел отказа — по якорю из подвала", () => {
    const { container } = render(<PrivacyPage />);
    const heading = container.querySelector("#opt-out");
    expect(heading?.textContent).toBe(content.privacy.section.optOut);
  });
});

describe("отказ от учёта на /privacy", () => {
  it("отказ: зовёт action и перезагружает страницу — Метрика должна не подняться", async () => {
    const { getByRole, getByText } = render(<PrivacyPage />);
    expect(getByText(t.statusOn)).toBeTruthy();
    fireEvent.click(getByRole("button", { name: t.optOut }));
    await waitFor(() => expect(docNav.reloadDocument).toHaveBeenCalledTimes(1));
    expect(actions.optOutOfAnalytics).toHaveBeenCalledTimes(1);
    expect(actions.optInToAnalytics).not.toHaveBeenCalled();
  });

  it("отказ уже стоит: кнопка возвращает учёт", async () => {
    document.cookie = "noanalytics=1; path=/";
    const { getByRole, getByText } = render(<PrivacyPage />);
    expect(getByText(t.statusOff)).toBeTruthy();
    fireEvent.click(getByRole("button", { name: t.optIn }));
    await waitFor(() => expect(docNav.reloadDocument).toHaveBeenCalledTimes(1));
    expect(actions.optInToAnalytics).toHaveBeenCalledTimes(1);
    expect(actions.optOutOfAnalytics).not.toHaveBeenCalled();
  });

  it("сбой — сообщение и без перезагрузки", async () => {
    actions.optOutOfAnalytics.mockResolvedValueOnce({ ok: false, error: "delete_failed" } as never);
    const { getByRole, findByRole } = render(<PrivacyPage />);
    fireEvent.click(getByRole("button", { name: t.optOut }));
    expect((await findByRole("alert")).textContent).toBe(t.failed);
    expect(docNav.reloadDocument).not.toHaveBeenCalled();
  });

  it("сеть упала — то же сообщение", async () => {
    actions.optOutOfAnalytics.mockRejectedValueOnce(new Error("network"));
    const { getByRole, findByRole } = render(<PrivacyPage />);
    fireEvent.click(getByRole("button", { name: t.optOut }));
    expect((await findByRole("alert")).textContent).toBe(t.failed);
    expect(docNav.reloadDocument).not.toHaveBeenCalled();
  });
});
