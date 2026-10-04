// Полоса «Рядом с вами» на главной: ближайшие к последнему месту «Где» вещи
// региона. Место живёт только на устройстве (localStorage), сервер его не
// знает — поэтому чтение с клиента. Роут, а не Server Action: actions — это
// POST, они идут очередью и не кэшируются, а здесь нужен кэшируемый GET
// (docs/architecture.md, исключения).
//
// Точка покупателя перед использованием снова округляется до трёх знаков, как
// в адресе страницы. Наружу — только подпись расстояния: ни километров числом,
// ни точки, ни адреса объявления. Город без геоданных и мусор вместо точки —
// пустой ответ. Лимит — общий с подсказками «Что».

import { NextResponse, type NextRequest } from "next/server";
import { checkLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/http/client-ip";
import { parseCity } from "@/lib/http/geo-params";
import { listingPath } from "@/lib/catalog/listing-path";
import { DISTANCE_TITLE, distanceLabel } from "@/lib/geo/distance";
import { locationQuery, parseLocation } from "@/lib/geo/location";
import { getCityBySlug, getNearbyListings, listingPhotos } from "@/server/catalog";
import { getCityScope } from "@/server/city";
import { NEARBY_LIMIT, type NearbyItem, type NearbyResponse } from "@/lib/catalog/nearby";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMPTY: NearbyResponse = { items: [] };

export async function GET(req: NextRequest): Promise<NextResponse> {
  const limit = checkLimit(clientIp(req.headers), "search");
  if (!limit.ok) {
    return NextResponse.json(EMPTY, {
      status: 429,
      headers: { "Retry-After": String(limit.retryAfterSec) },
    });
  }

  const sp = req.nextUrl.searchParams;
  const city = parseCity(sp.get("city"));
  if (!city) return NextResponse.json(EMPTY, { status: 400 });
  const raw = parseLocation({ loc: sp.get("loc"), lp: sp.get("lp"), la: sp.get("la") });

  try {
    const row = await getCityBySlug(city);
    if (!row) return NextResponse.json(EMPTY, { status: 404 });
    // Точность входа — не больше, чем у адреса страницы: три знака.
    const scope = raw ? await getCityScope(row, locationQuery(raw)) : null;
    const near = scope?.near ?? null;
    const rows = scope && near ? await getNearbyListings(scope.cityIds, near, NEARBY_LIMIT) : [];
    const items: NearbyItem[] = [];
    for (const r of rows) {
      if (!r.distance) continue;
      items.push({
        id: r.listing.id,
        title: r.listing.title,
        priceDay: r.listing.priceDay,
        href: listingPath(r.citySlug, r.categorySlug, r.listing.slug, r.listing.id),
        photoUrl: listingPhotos(r.listing)[0]?.url ?? null,
        distanceLabel: distanceLabel(r.distance.km, r.distance.approx),
        distanceTitle: DISTANCE_TITLE,
      });
    }
    return NextResponse.json({ items } satisfies NearbyResponse, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (e) {
    console.error("[listings/nearby]", e);
    return NextResponse.json(EMPTY, { status: 503 });
  }
}
