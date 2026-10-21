// Полная загрузка документа — там, где клиентский переход оставил бы работать
// счётчик Метрики, поднятый прошлой страницей (metrika-url.ts). Отдельным
// модулем: window.location в jsdom не подменить, и тесты мокают этот модуль.

export function loadDocument(href: string): void {
  window.location.assign(href);
}

export function reloadDocument(): void {
  window.location.reload();
}
