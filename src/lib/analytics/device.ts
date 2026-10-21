// Телефон или компьютер — по User-Agent. Сам User-Agent не хранится: админке
// нужно только это различие. Планшет считается компьютером: у iPad Safari
// по умолчанию и так представляется Mac'ом, а Android-планшет не пишет
// «Mobile».

export type Device = "phone" | "desktop";

const PHONE_UA = /iPhone|iPod|Android.*Mobile|Windows Phone|IEMobile|Opera Mini|\bMobi\b/i;

export function deviceOf(ua: string | null | undefined): Device | null {
  if (!ua) return null;
  return PHONE_UA.test(ua) ? "phone" : "desktop";
}
