import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Цель «Начал переписку» — успех startThread из композера нового треда.
// Сообщения в существующую переписку и отказ сервера её не дают.
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace }),
  useSelectedLayoutSegment: () => null,
}));
const chat = vi.hoisted(() => ({
  markThreadRead: vi.fn(async () => ({ ok: true, data: undefined })),
  fetchOlderMessages: vi.fn(),
  postMessage: vi.fn(),
  startThread: vi.fn(),
}));
vi.mock("@/server/actions/chat", () => chat);
vi.mock("@/server/actions/realtime", () => ({
  fetchNewerMessages: vi.fn(async () => ({ ok: true, data: { messages: [], hasMore: false } })),
  fetchRealtimeUpdate: vi.fn(async () => ({
    ok: true, data: { counters: { messages: 0, incoming: 0, mine: 0 }, toast: null },
  })),
}));
const reachGoal = vi.hoisted(() => vi.fn());
vi.mock("@/components/analytics/goals", () => ({ reachGoal }));

const { ThreadView } = await import("@/components/chat/ThreadView");
const { content } = await import("@theme/content");

const message = (id: string, body: string) => ({
  id, senderUserId: "01ME", kind: "user" as const, body, meta: null,
  createdAt: new Date("2026-08-31T10:00:00Z"),
});

beforeEach(() => {
  reachGoal.mockClear();
  replace.mockClear();
  chat.startThread.mockReset();
  chat.postMessage.mockReset();
});

function send(text: string) {
  fireEvent.change(screen.getByLabelText(content.chat.composerLabel), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: content.chat.send }));
}

describe("цель chat_started", () => {
  it("новая переписка — одна цель без параметров", async () => {
    chat.startThread.mockResolvedValue({
      ok: true, data: { threadId: "01T", message: message("01A", "Здравствуйте"), created: true },
    });
    render(<ThreadView mode={{ kind: "new", listingId: "01L" }} viewerId="01ME" initialMessages={[]} initialHasMore={false} />);
    send("Здравствуйте");
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/chat/01T"));
    expect(reachGoal.mock.calls).toEqual([["chat_started"]]);
  });

  // Композер «Написать» открыт в одной вкладке, а заявка из другой уже завела
  // тред заметкой о сделке: startThread дописывает в него. Переписка началась
  // с заявки, а не со «спрошу сначала».
  it("тред уже был — сообщение дописано, цели нет", async () => {
    chat.startThread.mockResolvedValue({
      ok: true, data: { threadId: "01T", message: message("01A", "Здравствуйте"), created: false },
    });
    render(<ThreadView mode={{ kind: "new", listingId: "01L" }} viewerId="01ME" initialMessages={[]} initialHasMore={false} />);
    send("Здравствуйте");
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/chat/01T"));
    expect(reachGoal).not.toHaveBeenCalled();
  });

  it("отказ сервера — цели нет", async () => {
    chat.startThread.mockResolvedValue({ ok: false, error: "listing_unavailable" });
    render(<ThreadView mode={{ kind: "new", listingId: "01L" }} viewerId="01ME" initialMessages={[]} initialHasMore={false} />);
    send("Здравствуйте");
    await waitFor(() => expect(chat.startThread).toHaveBeenCalled());
    expect(reachGoal).not.toHaveBeenCalled();
  });

  it("сообщение в существующую переписку — не начало", async () => {
    chat.postMessage.mockResolvedValue({ ok: true, data: { message: message("01B", "Ещё вопрос") } });
    render(<ThreadView mode={{ kind: "thread", threadId: "01T" }} viewerId="01ME" initialMessages={[]} initialHasMore={false} />);
    send("Ещё вопрос");
    await waitFor(() => expect(chat.postMessage).toHaveBeenCalled());
    expect(reachGoal).not.toHaveBeenCalled();
  });
});
