// ClientID Метрики в памяти документа. Спрашивает его MetrikaGoals, когда
// счётчик поднят (YandexMetrika.tsx), и тот же ответ остаётся здесь: кнопка
// «Забронировать в Telegram» кладёт ClientID в маяк черновика синхронно, в
// обработчике клика. Ждать ответа счётчика там нельзя — переход в Telegram
// открывает приложение только по жесту, без await.
//
// Нет ClientID (счётчик не поднят, отказ от учёта, Метрика ещё не ответила) —
// маяк уходит без него, сервер возьмёт ClientID гостя из своей статистики.

const CLIENT_ID_RE = /^\d{1,32}$/;

let known: string | null = null;

/** Ответ счётчика → ClientID или null: только цифры, до 32. */
function clean(cid: unknown): string | null {
  const value = typeof cid === "string" || typeof cid === "number" ? String(cid) : "";
  return CLIENT_ID_RE.test(value) ? value : null;
}

/**
 * Спросить ClientID у поднятого счётчика. `onValue` зовётся, только если
 * пришло годное значение. Счётчик — чужой код: его сбой — просто без ClientID.
 */
export function requestYmClientId(counterId: number, onValue?: (cid: string) => void): void {
  try {
    window.ym?.(counterId, "getClientID", (cid: unknown) => {
      const value = clean(cid);
      if (!value) return;
      known = value;
      onValue?.(value);
    });
  } catch {
    // Без ClientID карточка гостя покажет «ещё не получен», а маяк уйдёт без него.
  }
}

/** ClientID, если счётчик его уже отдал на этой загрузке документа. */
export function ymClientIdNow(): string | null {
  return known;
}

/** Только для тестов: исходное состояние модуля. */
export function _resetYmClientForTests(): void {
  known = null;
}
