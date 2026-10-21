// @vitest-environment node
// Один vid — одно состояние: гость или конкретный аккаунт.
import { describe, expect, it } from "vitest";
import { decideLink } from "@/lib/analytics/link";

describe("decideLink", () => {
  it("строки нет — завести", () => {
    expect(decideLink(null, null)).toEqual({ kind: "create" });
    expect(decideLink(null, "u1")).toEqual({ kind: "create" });
  });

  it("состояние совпадает — та же строка", () => {
    expect(decideLink({ userId: null, hasEvents: true }, null)).toEqual({ kind: "keep" });
    expect(decideLink({ userId: "u1", hasEvents: true }, "u1")).toEqual({ kind: "keep" });
  });

  // История до входа с аккаунтом не связывается.
  it("гость с историей вошёл — новый vid, старый кончается входом", () => {
    expect(decideLink({ userId: null, hasEvents: true }, "u1")).toEqual({ kind: "switch", reason: "login", guestLogin: true });
  });

  // Строка без событий — гость, чью историю удалил срок хранения: его первый
  // заход и источник аккаунту не принадлежат.
  it("гость без событий вошёл — тоже новый vid, без отметки входа", () => {
    expect(decideLink({ userId: null, hasEvents: false }, "u1")).toEqual({ kind: "switch", reason: "login", guestLogin: false });
  });

  it("аккаунт сменился или человек вышел — новый vid", () => {
    expect(decideLink({ userId: "u1", hasEvents: true }, "u2")).toEqual({ kind: "switch", reason: "account", guestLogin: false });
    expect(decideLink({ userId: "u1", hasEvents: true }, null)).toEqual({ kind: "switch", reason: "logout", guestLogin: false });
    expect(decideLink({ userId: "u1", hasEvents: false }, null)).toEqual({ kind: "switch", reason: "logout", guestLogin: false });
  });
});
