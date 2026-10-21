// @vitest-environment node
// Источник первой загрузки документа: поисковик, мессенджер, реклама,
// кампания, сайт, прямой заход, свой сайт.
import { describe, expect, it } from "vitest";
import { classifySource } from "@/lib/analytics/source";
import { entryOf } from "@/lib/analytics/sanitize";

const SITE = "inrenta.ru";
const from = (path: string, ref?: string) => classifySource(entryOf(path, ref), SITE);

describe("classifySource", () => {
  it.each([
    ["Яндекс", "https://yandex.ru/search/?text=x", { kind: "search", label: "yandex" }],
    ["ya.ru", "https://ya.ru/", { kind: "search", label: "yandex" }],
    ["приложение Яндекса", "android-app://com.yandex.searchapp/", { kind: "search", label: "yandex" }],
    ["Google", "https://www.google.com/", { kind: "search", label: "google" }],
    ["google.ru", "https://www.google.ru/", { kind: "search", label: "google" }],
    ["t.me", "https://t.me/somechannel/12", { kind: "social", label: "telegram" }],
    ["Telegram на Android", "android-app://org.telegram.messenger/", { kind: "social", label: "telegram" }],
    ["vk", "https://vk.com/wall-1_2", { kind: "social", label: "vk" }],
    ["m.vk.com", "https://m.vk.com/", { kind: "social", label: "vk" }],
    ["чужой сайт", "https://forum.example.org/thread/1", { kind: "referral", label: "forum.example.org" }],
  ])("%s", (_name, ref, expected) => {
    expect(from("/", ref)).toEqual(expected);
  });

  it("utm без признаков рекламы — кампания с utm_source", () => {
    expect(from("/?utm_source=telegram_post&utm_medium=social", "https://t.me/x")).toEqual({
      kind: "campaign", label: "telegram_post",
    });
  });

  it("yclid — реклама Яндекса, id клика не нужен", () => {
    expect(from("/krasnodar?yclid=123456789", "https://yandex.ru/")).toEqual({ kind: "ad", label: "yandex" });
    expect(from("/?gclid=abc")).toEqual({ kind: "ad", label: "google" });
  });

  it("платный utm_medium — реклама", () => {
    expect(from("/?utm_source=yandex&utm_medium=cpc")).toEqual({ kind: "ad", label: "yandex" });
  });

  it("без referrer'а и меток — прямой заход", () => {
    expect(from("/krasnodar")).toEqual({ kind: "direct", label: "" });
    expect(from("/", "")).toEqual({ kind: "direct", label: "" });
  });

  it("свой сайт — внутренний переход, и с www", () => {
    expect(from("/", "https://inrenta.ru/krasnodar")).toEqual({ kind: "internal", label: "" });
    expect(from("/", "https://www.inrenta.ru/")).toEqual({ kind: "internal", label: "" });
  });

  // Поисковик — сам поисковый хост: почта и сервисы тех же компаний — не поиск.
  it.each([
    "https://mail.yandex.ru/", "https://market.yandex.ru/", "https://mail.google.com/mail/u/0/",
    "https://accounts.google.com/", "https://e.mail.ru/inbox/",
  ])("%s — сайт, а не поиск", (ref) => {
    expect(from("/", ref)).toEqual({ kind: "referral", label: new URL(ref).hostname });
  });

  it.each(["https://yandex.com.tr/search/", "https://yandex.kz/", "https://www.google.co.uk/", "https://google.com.ua/"])(
    "%s — поиск",
    (ref) => {
      expect(from("/", ref).kind).toBe("search");
    },
  );

  // Возврат со страницы входа Яндекс ID или VK ID — продолжение входа, а не
  // переход из поиска или соцсети.
  it.each([
    "https://oauth.yandex.ru/authorize?x=1", "https://passport.yandex.ru/auth", "https://oauth.yandex.com/",
    "https://id.vk.com/auth", "https://id.vk.ru/", "https://oauth.vk.com/authorize", "https://login.vk.com/",
  ])("%s — после входа в аккаунт", (ref) => {
    expect(from("/", ref)).toEqual({ kind: "account", label: "login" });
  });
});
