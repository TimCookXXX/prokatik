// URL карточки товара: /{city}/{categorySlug}/{listingSlug}-{listingId}.
// id — ULID (26 символов Crockford base32); отделяем его от хвоста slug.

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

export function extractListingId(lastSegment: string): { slug: string; id: string } | null {
  const idx = lastSegment.lastIndexOf("-");
  if (idx <= 0) return null;
  const id = lastSegment.slice(idx + 1);
  const slug = lastSegment.slice(0, idx);
  if (!ULID_RE.test(id)) return null;
  return { slug, id };
}

export function listingPath(
  citySlug: string, categorySlug: string, listingSlug: string, listingId: string,
): string {
  return `/${citySlug}/${categorySlug}/${listingSlug}-${listingId}`;
}

/** Параметры, которые канонический редирект переносит: даты, количество, «Где». */
export const CANONICAL_CARRY_KEYS = ["from", "to", "qty", "loc", "la", "src", "lp"] as const;

/**
 * Канонический путь с переносимой частью query — для permanentRedirect со
 * старого слага карточки или подраздела по неверному пути. Без query редирект
 * терял бы выбранные даты и «Где». Переносится только белый список: фильтры и
 * прочий мусор каноническому адресу не нужны. Значения не проверяются — их
 * разбирает целевая страница (мусор там сводится к «нет фильтра»).
 * Метаданные canonical по-прежнему строятся без query.
 */
export function canonicalHref(
  path: string,
  sp: Record<string, string | string[] | undefined>,
): string {
  const out = new URLSearchParams();
  for (const key of CANONICAL_CARRY_KEYS) {
    const raw = sp[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value) out.set(key, value);
  }
  const qs = out.toString();
  return qs ? `${path}?${qs}` : path;
}
