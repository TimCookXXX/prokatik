// Обратный геокодер: точка «Моё местоположение» → подпись адреса («улица
// Красная, 162Б»). Дом не дальше 60 м, иначе улица, иначе населённый пункт;
// далеко от всего — hit: null. Город задаёт регион геоданных.

import { NextResponse, type NextRequest } from "next/server";
import { checkLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/http/client-ip";
import { parseCity, parsePoint } from "@/lib/http/geo-params";
import { reverseGeocode } from "@/server/geocoder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const limited = checkLimit(clientIp(req.headers), "geo");
  if (!limited.ok) {
    return NextResponse.json({ hit: null }, {
      status: 429,
      headers: { "Retry-After": String(limited.retryAfterSec) },
    });
  }

  const sp = req.nextUrl.searchParams;
  const city = parseCity(sp.get("city"));
  const point = parsePoint(sp.get("lat"), sp.get("lon"));
  if (!city || !point) return NextResponse.json({ hit: null }, { status: 400 });

  try {
    return NextResponse.json({ hit: await reverseGeocode(point, city) });
  } catch (e) {
    console.error("[geo/reverse]", e);
    return NextResponse.json({ hit: null }, { status: 503 });
  }
}
