// Адреса «поделиться» для мессенджеров — запасной путь, когда системного листа
// Web Share нет (десктоп). Делится всегда канонический адрес объявления: его
// собирает страница, сюда он приходит готовым.

export interface ShareLinks {
  telegram: string;
  whatsapp: string;
  vk: string;
}

export function shareLinks(url: string, text: string): ShareLinks {
  const u = encodeURIComponent(url);
  return {
    telegram: `https://t.me/share/url?url=${u}&text=${encodeURIComponent(text)}`,
    // У WhatsApp поля адреса нет: ссылка идёт в конце текста, иначе превью не
    // соберётся.
    whatsapp: `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`,
    // Заголовок и картинку VK берёт сам из Open Graph страницы.
    vk: `https://vk.com/share.php?url=${u}`,
  };
}
