// Связка id браузера с аккаунтом. Правило: один vid — одно состояние, гость
// или конкретный аккаунт. Роут сбора сравнивает аккаунт строки visitors с
// пользователем текущей сессии и решает, писать ли в ту же строку или выдать
// браузеру новый id.
//
// История до входа с аккаунтом не связывается (решение владельца): гость,
// вошедший в аккаунт, получает новый vid, а старый, если у него есть история,
// кончается событием «вошёл». Поэтому удаление аккаунта каскадом уносит только
// то, что человек делал в аккаунте, и не задевает чужого — например, того, кто
// сидел за тем же компьютером до него.
//
// Гостевую строку на месте не связывает ничто: строка без событий — это гость,
// чью историю уже удалил срок хранения, а его первый заход и источник к
// аккаунту не относятся.

export interface VisitorState {
  /** Аккаунт строки; null — гость. */
  userId: string | null;
  /** Есть ли у строки хоть одно событие. */
  hasEvents: boolean;
}

/** Почему браузер получает новый id: вошёл, вышел или сменил аккаунт. */
export type SwitchReason = "login" | "logout" | "account";

export type LinkDecision =
  /** Строки нет: завести; есть сессия — сразу с аккаунтом. */
  | { kind: "create" }
  /** Состояние совпадает с сессией: писать в эту строку. */
  | { kind: "keep" }
  /**
   * Новый vid. `guestLogin` — прежний был гостем с историей и человек вошёл:
   * его история кончается событием «вошёл».
   */
  | { kind: "switch"; reason: SwitchReason; guestLogin: boolean };

export function decideLink(row: VisitorState | null, sessionUserId: string | null): LinkDecision {
  if (!row) return { kind: "create" };
  if (row.userId === sessionUserId) return { kind: "keep" };
  if (row.userId === null) return { kind: "switch", reason: "login", guestLogin: row.hasEvents };
  return { kind: "switch", reason: sessionUserId === null ? "logout" : "account", guestLogin: false };
}
