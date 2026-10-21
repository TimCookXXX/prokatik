// Связка id браузера с аккаунтом. Правило: один vid — одно состояние, гость
// или конкретный аккаунт. Роут сбора сравнивает аккаунт строки visitors с
// пользователем текущей сессии и решает, писать ли в ту же строку или выдать
// браузеру новый id.
//
// История до входа с аккаунтом не связывается (решение владельца): гость с
// историей, вошедший в аккаунт, получает новый vid, а старый кончается
// событием «вошёл». Поэтому удаление аккаунта каскадом уносит только то, что
// человек делал в аккаунте, и не задевает чужого — например, того, кто сидел
// за тем же компьютером до него.

export interface VisitorState {
  /** Аккаунт строки; null — гость. */
  userId: string | null;
  /** Есть ли у строки хоть одно событие. */
  hasEvents: boolean;
}

export type LinkDecision =
  /** Строки нет: завести; есть сессия — сразу связанной. */
  | { kind: "create" }
  /** Состояние совпадает с сессией: писать в эту строку. */
  | { kind: "keep" }
  /** Гость без событий, появилась сессия: связать эту же строку. */
  | { kind: "link" }
  /**
   * Новый vid. `guestLogin` — прежний был гостем с историей и человек вошёл:
   * его история кончается событием «вошёл». Иначе аккаунт сменился или
   * человек вышел.
   */
  | { kind: "switch"; guestLogin: boolean };

export function decideLink(row: VisitorState | null, sessionUserId: string | null): LinkDecision {
  if (!row) return { kind: "create" };
  if (row.userId === sessionUserId) return { kind: "keep" };
  if (row.userId === null) {
    return row.hasEvents ? { kind: "switch", guestLogin: true } : { kind: "link" };
  }
  return { kind: "switch", guestLogin: false };
}
