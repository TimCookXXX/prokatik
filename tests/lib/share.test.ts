import { describe, expect, it } from "vitest";
import { shareLinks } from "@/lib/share";

const url = "https://inrenta.ru/krasnodar/instrumenty/drel-01JABCDEFGHJKMNPQRSTVWXYZ0";
const text = "Дрель — аренда в Краснодаре, 500 ₽/сутки";

describe("shareLinks", () => {
  it("Telegram: url и text отдельными параметрами", () => {
    const u = new URL(shareLinks(url, text).telegram);
    expect(u.origin + u.pathname).toBe("https://t.me/share/url");
    expect(u.searchParams.get("url")).toBe(url);
    expect(u.searchParams.get("text")).toBe(text);
  });

  it("WhatsApp: ссылка в конце текста", () => {
    const u = new URL(shareLinks(url, text).whatsapp);
    expect(u.origin + u.pathname).toBe("https://wa.me/");
    expect(u.searchParams.get("text")).toBe(`${text} ${url}`);
  });

  it("VK: только адрес", () => {
    const u = new URL(shareLinks(url, text).vk);
    expect(u.origin + u.pathname).toBe("https://vk.com/share.php");
    expect([...u.searchParams.keys()]).toEqual(["url"]);
    expect(u.searchParams.get("url")).toBe(url);
  });

  it("адрес с & и # не ломает параметры", () => {
    const tricky = "https://x.example/a?b=1&c=2#d";
    expect(new URL(shareLinks(tricky, "t").telegram).searchParams.get("url")).toBe(tricky);
  });
});
