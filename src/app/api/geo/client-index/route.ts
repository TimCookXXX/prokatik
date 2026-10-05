// Мини-индекс адресов для браузера: улицы, населённые пункты, микрорайоны и
// объекты без домов (≈ 0,9 МБ, gzip ≈ 250 КБ — сжимает Caddy). По нему поле
// адреса подсказывает мгновенно, без сети; дома — с /api/geo/suggest.
//
// Один на регион геоданных, город лишь называет регион. ETag — метка версии
// данных; ссылка с ?v=<метка> (её отдаёт страница из getCitiesGeo) кэшируется
// навсегда: новые данные — новая метка и новая ссылка. Лимита нет: ответ
// immutable по v, повтор — 304 по ETag.
//
// Выборка производная от OSM и раздаётся по ODbL: лицензия и источники — в
// самом JSON (license, attribution) и в заголовке Link rel="license".
// Предложение базы по запросу — на странице /sources.

import { NextResponse, type NextRequest } from "next/server";
import { parseCity } from "@/lib/http/geo-params";
import { clientIndexJson } from "@/server/geocoder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LICENSE_LINK = '<https://opendatacommons.org/licenses/odbl/1-0/>; rel="license"';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const city = parseCity(req.nextUrl.searchParams.get("city"));
  if (!city) return NextResponse.json({ error: "bad_city" }, { status: 400 });

  let index: Awaited<ReturnType<typeof clientIndexJson>>;
  try {
    index = await clientIndexJson(city);
  } catch (e) {
    console.error("[geo/client-index]", e);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
  if (!index) return NextResponse.json({ error: "no_addresses" }, { status: 404 });

  const etag = `"${index.token}"`;
  const versioned = req.nextUrl.searchParams.get("v") === index.token;
  const headers = {
    ETag: etag,
    Link: LICENSE_LINK,
    "Cache-Control": versioned ? "public, max-age=31536000, immutable" : "public, max-age=0, must-revalidate",
  };
  if (req.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers });
  return new NextResponse(index.json, { headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
}
