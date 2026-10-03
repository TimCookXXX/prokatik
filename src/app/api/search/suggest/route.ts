// Подсказки панели «Что»: объявления и разделы города по набранному тексту
// (src/server/search.ts). Роут, а не Server Action: actions — это POST, клиент
// выполняет их очередью и не кэширует, а подсказкам нужен параллельный
// кэшируемый GET (docs/architecture.md, исключения).
//
// Ответ зависит от города, запроса и свежести индекса — короткий private-кэш
// снимает повторы при стирании и повторном наборе. Лимит — от выкачивания
// каталога перебором; сверх него и при ошибке ответ пустой, и клиент
// показывает «подсказок нет» со строкой «Показать все».

import { NextResponse, type NextRequest } from "next/server";
import { checkLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/http/client-ip";
import { MAX_QUERY_LENGTH } from "@/lib/search/match";
import { suggestForCity, type SuggestResult } from "@/server/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SLUG = 80;

const EMPTY: SuggestResult = { items: [], categories: [] };

export async function GET(req: NextRequest): Promise<NextResponse> {
  const limit = checkLimit(clientIp(req.headers), "search");
  if (!limit.ok) {
    return NextResponse.json(EMPTY, {
      status: 429,
      headers: { "Retry-After": String(limit.retryAfterSec) },
    });
  }

  const sp = req.nextUrl.searchParams;
  const city = (sp.get("city") ?? "").trim().slice(0, MAX_SLUG);
  const q = (sp.get("q") ?? "").slice(0, MAX_QUERY_LENGTH);
  if (!city) return NextResponse.json(EMPTY, { status: 400 });

  try {
    const result = await suggestForCity(city, q);
    if (!result) return NextResponse.json(EMPTY, { status: 404 });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, max-age=30" } });
  } catch (e) {
    console.error("[search/suggest]", e);
    return NextResponse.json(EMPTY, { status: 503 });
  }
}
