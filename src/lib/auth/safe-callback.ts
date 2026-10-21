// Только собственный путь: иначе callbackUrl превращается в открытый редирект.
// Проверки начала строки мало — `new URL` разворачивает часть «относительных»
// адресов на чужой домен, поэтому итог сверяется резолвом.
//
// Leaf-модуль: правило нужно и входу (session.ts), и очистке адресов своей
// статистики (lib/analytics/sanitize.ts), которой база и окружение ни к чему.
export function safeCallback(input: string | null | undefined): string {
  if (!input || !input.startsWith("/") || input.startsWith("//")) return "/";
  // Обратный слэш и управляющие символы ловим САМИ, до new URL:
  //   "/\evil.com"  → new URL уводит на https://evil.com/
  //   "/\tevil.com" → URL вырезает tab ещё до резолва
  // Дефис и пробел в класс НЕ добавлять: дефис есть в каждом слаге товара и
  // города, иначе любой возврат на карточку схлопнется в "/".
  if (/[\\\u0000-\u001F\u007F]/.test(input)) return "/";

  try {
    const base = "http://callback.invalid";
    const url = new URL(input, base);
    if (url.origin !== base) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
