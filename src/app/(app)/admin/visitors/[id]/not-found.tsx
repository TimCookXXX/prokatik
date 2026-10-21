import Link from "next/link";
import { content } from "@theme/content";

// Браузера нет: его удалили по сроку хранения или по отказу от учёта, а ссылка
// на него осталась. Объяснение — внутри админки, с дорогой обратно к списку,
// а не публичная страница 404. Права проверены до этого: notFound() зовёт
// страница уже после assertAdmin().
export default function VisitorNotFound() {
  const t = content.adminAnalytics.visitor;
  return (
    <section className="flex flex-col gap-3">
      <Link href="/admin/visitors" className="text-sm text-muted-foreground underline underline-offset-2 hoverable hover:text-foreground">
        {t.back}
      </Link>
      <p className="rounded-lg border border-border bg-card px-4 py-4 text-sm">{t.notFound}</p>
    </section>
  );
}
