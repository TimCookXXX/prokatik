// Код заявки без аккаунта: `INR-4821`. Его называют вслух в прокате, поэтому
// он короткий и из цифр. Уникальность держит индекс booking_leads_code_unique:
// код выдаётся случайным, и при коллизии вставка или отправка повторяется с
// новым (withLeadCode). Четырёх цифр хватает надолго; если восемь попыток
// подряд упёрлись в занятые — пространство тесно, дальше пять цифр.
//
// Код не секрет: назвать его может кто угодно, в прокате сверяют по телефону.

import { randomInt } from "node:crypto";

export const LEAD_CODE_PREFIX = "INR-";
export const LEAD_CODE_RE = /^INR-\d{4,5}$/;
/** После стольких коллизий код удлиняется до пяти цифр. */
const SHORT_CODE_TRIES = 8;
/** Всего попыток выдать код, прежде чем сдаться. */
export const MAX_CODE_TRIES = 16;

/** Случайный код; `collisions` — сколько предыдущих попыток упёрлись в занятый. */
export function leadCode(collisions = 0): string {
  const digits = collisions >= SHORT_CODE_TRIES ? 5 : 4;
  return LEAD_CODE_PREFIX + String(randomInt(0, 10 ** digits)).padStart(digits, "0");
}

/**
 * Выполняет запись с новым кодом, пока `isCollision` узнаёт в ошибке занятый
 * код. Другие ошибки уходят наверх сразу; после MAX_CODE_TRIES — последняя
 * коллизия. Что считать коллизией, знает вызывающий: lib не разбирает ошибки
 * драйвера базы.
 */
export async function withLeadCode<T>(
  write: (code: string) => Promise<T>,
  isCollision: (e: unknown) => boolean,
  generate: (collisions: number) => string = leadCode,
): Promise<T> {
  for (let collisions = 0; ; collisions++) {
    try {
      return await write(generate(collisions));
    } catch (e) {
      if (!isCollision(e) || collisions + 1 >= MAX_CODE_TRIES) throw e;
    }
  }
}
