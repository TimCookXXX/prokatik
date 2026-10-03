// Подсказки адресов своим геокодером (src/server/geocoder.ts): сразу с
// координатами и точностью — второго запроса за точкой нет. Без `near`
// ранжирует от центра города. Кэш — только браузера и на минуту: в адресе
// запроса бывает точка пользователя (`near`), а выключенный в админке регион
// должен перестать подсказывать сразу. Лимит — от выкачивания базы адресов
// перебором; сверх него и при ошибке ответ пустой и не кэшируется.
//
// Роут, а не Server Action, по той же причине, что /api/search/suggest:
// подсказкам нужен параллельный кэшируемый GET (docs/architecture.md).

import { NextResponse, type NextRequest } from "next/server";
import { checkLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/http/client-ip";
import { parseCity, parseNear } from "@/lib/http/geo-params";
import { suggestAddresses, SUGGEST_LIMIT } from "@/server/geocoder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Полный адрес ФИАС бывает длиннее 120 знаков («Россия, 350000, Краснодарский
// край, городской округ город Краснодар, …, ул. Российская, д. 267/4») —
// режем только совсем длинное; слов движок берёт не больше 24.
const MAX_QUERY = 300;
const MAX_LIMIT = 10;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const limited = checkLimit(clientIp(req.headers), "geo");
  if (!limited.ok) {
    return NextResponse.json({ items: [] }, {
      status: 429,
      headers: { "Retry-After": String(limited.retryAfterSec) },
    });
  }

  const sp = req.nextUrl.searchParams;
  const city = parseCity(sp.get("city"));
  if (!city) return NextResponse.json({ items: [] }, { status: 400 });
  const q = (sp.get("q") ?? "").slice(0, MAX_QUERY);
  const limitRaw = Number(sp.get("limit") ?? SUGGEST_LIMIT);
  const limit = Number.isInteger(limitRaw) ? Math.min(MAX_LIMIT, Math.max(1, limitRaw)) : SUGGEST_LIMIT;

  try {
    const items = await suggestAddresses(q, city, { near: parseNear(sp.get("near")), limit });
    return NextResponse.json({ items }, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (e) {
    console.error("[geo/suggest]", e);
    return NextResponse.json({ items: [] }, { status: 503 });
  }
}
