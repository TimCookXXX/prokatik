export const seo = {
  siteName: "inrenta",
  defaultTitle: "inrenta — аренда и прокат вещей в вашем городе",
  defaultDescription:
    "Аренда вещей в вашем городе: инструмент, спорт, туризм, платья, фототехника — от прокатов и частных владельцев. Заявка на бронь онлайн.",
  // Дубль --color-background из блока .dark в theme/tokens.css: в <meta> и в
  // манифест CSS-переменную не подставить. Расхождение ловит тест
  // tests/app/icons.test.ts, иначе смена палитры увела бы цвет молча.
  themeColor: "#171719",
  locale: "ru_RU",
  // Картинки для соцсетей по умолчанию здесь нет: её рисует при сборке
  // src/app/opengraph-image.tsx, и адрес с хешем Next ставит сам.
} as const;
