-- Два раздела назывались одинаково «Аксессуары» (в одежде и в электронике): в
-- заголовках страниц и крошках их было не различить. Слаги и адреса прежние.
-- Условие на прежнее имя — повторный прогон и база без этих строк проходят тихо.
UPDATE "categories" SET "name" = 'Аксессуары к одежде'
  WHERE "slug" = 'aksessuary-odezhda' AND "name" = 'Аксессуары';--> statement-breakpoint
UPDATE "categories" SET "name" = 'Аксессуары для электроники'
  WHERE "slug" = 'aksessuary-elektronika' AND "name" = 'Аксессуары';
