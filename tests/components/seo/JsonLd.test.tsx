import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { JsonLd } from "@/components/seo/JsonLd";
import { buildBreadcrumbJsonLd, buildProductJsonLd } from "@/lib/jsonld";

// Заголовок и описание объявления пишет пользователь, премодерации нет. Если
// сериализация не экранирует `<`, такая строка закрывает тег ld+json и всё, что
// за ней, браузер разбирает уже как разметку — то есть исполняет.
const BREAKOUT = 'x</script><script>alert(1&&2)</script>';

// Проверяем именно строку SSR, а не DOM после render(): в браузер уезжает она.
function payloadOf(html: string): string {
  // Ровно один закрывающий тег — значит пользовательская строка его не добавила.
  expect(html.split("</script>")).toHaveLength(2);
  return html.slice(html.indexOf(">") + 1, html.lastIndexOf("</script>"));
}

// Внутри тега не должно остаться ни одного символа разметки: `<` закрывает тег,
// `>` и `&` экранируются заодно — проверяем все три, иначе замены можно молча
// выкинуть из компонента и тесты этого не заметят.
function escapedPayloadOf(html: string): string {
  const payload = payloadOf(html);
  for (const ch of ["<", ">", "&"]) expect(payload).not.toContain(ch);
  return payload;
}

describe("<JsonLd>", () => {
  const base = {
    title: "Перфоратор Bosch",
    description: "Мощный перфоратор.",
    price: { amount: 500, unit: "day" as const },
    photoUrls: ["https://img.example/1.webp"],
    url: "https://inrenta.example/kazan/elektroinstrument/perforator-01ARZ3NDEKTSV4RRFFQ69G5FAV",
    sellerName: "Артём",
    available: true,
  };

  it("не даёт полям объявления закрыть тег и не меняет их значения", () => {
    const html = renderToStaticMarkup(
      <JsonLd
        data={buildProductJsonLd({
          ...base,
          title: BREAKOUT,
          description: BREAKOUT,
          sellerName: BREAKOUT,
        })}
      />,
    );

    const ld = JSON.parse(escapedPayloadOf(html));
    // Экранирование не должно портить данные: < для JSON.parse — тот же `<`,
    // и робот поисковика видит исходный текст.
    expect(ld.name).toBe(BREAKOUT);
    expect(ld.description).toBe(BREAKOUT);
    expect(ld.offers.seller.name).toBe(BREAKOUT);
  });

  it("экранирует и хлебные крошки — туда попадает тот же заголовок", () => {
    const html = renderToStaticMarkup(
      <JsonLd
        data={buildBreadcrumbJsonLd(
          [{ name: "Казань", url: "/kazan" }, { name: BREAKOUT }],
          "https://inrenta.example",
        )}
      />,
    );

    expect(JSON.parse(escapedPayloadOf(html)).itemListElement[1].name).toBe(BREAKOUT);
  });
});
