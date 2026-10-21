import type { Metadata } from "next";
import { content } from "@theme/content";
import { siteUrl } from "@/lib/site-config";
import { ruPlural } from "@/lib/plural";
import {
  BACKUP_RETENTION_DAYS, EVENT_RETENTION_DAYS, VISITOR_RETENTION_DAYS,
} from "@/lib/analytics/limits";
import { AnalyticsOptOut } from "@/components/analytics/AnalyticsOptOut";

// Функция, а не объект: адрес сайта читается при запросе, а не при импорте.
export function generateMetadata(): Metadata {
  return {
    title: "Политика конфиденциальности",
    description: content.privacy.intro,
    alternates: { canonical: `${siteUrl()}/privacy` },
  };
}

/** Якорь раздела с кнопкой отказа: на него ведёт ссылка в подвале. */
const OPT_OUT_ANCHOR = "opt-out";

export default function PrivacyPage() {
  const p = content.privacy;
  const s = p.section;
  const email = content.site.contactEmail;
  // Сроки — те же константы, по которым чистит код: назвать людям один срок, а
  // удалять по другому текст не может. Число и «дней» не разрываются строкой.
  const days = (n: number) => `${n}\u00a0${ruPlural(n, ...s.dayForms)}`;
  return (
    // Заголовок на телефоне мельче прозы: «конфиденциальности» одним словом в
    // 36px шире экрана в 390px и давало горизонтальную прокрутку страницы.
    <main className="container mx-auto max-w-2xl py-12 px-4 prose prose-neutral dark:prose-invert prose-h1:text-3xl prose-h1:break-words sm:prose-h1:text-4xl">
      <h1>{p.title}</h1>
      <p>{p.intro}</p>

      <h2>{s.whoWeAre}</h2>
      <p>{s.whoWeAreBody}</p>

      <h2>{s.whatWeCollect}</h2>
      <p>{s.whatWeCollectBody}</p>

      <h2>{s.statistics}</h2>
      {s.statisticsBody.map((text) => <p key={text}>{text}</p>)}

      <h2>{s.metrika}</h2>
      <p>{s.metrikaBody}</p>

      <h2>{s.cookies}</h2>
      <p>{s.cookiesIntro}</p>
      <ul>
        {s.cookiesItems.map((text) => <li key={text}>{text}</li>)}
      </ul>
      <p>{s.cookiesStorage}</p>

      <h2>{s.retention}</h2>
      <p>
        {s.retentionBody(days(EVENT_RETENTION_DAYS), days(VISITOR_RETENTION_DAYS), days(BACKUP_RETENTION_DAYS))}
      </p>

      <h2 id={OPT_OUT_ANCHOR} className="scroll-mt-24">{s.optOut}</h2>
      <p>{s.optOutBody}</p>
      <AnalyticsOptOut />

      <h2>{s.delete}</h2>
      <p>{s.deleteBody}</p>

      <h2>{s.contact}</h2>
      <p>
        {p.contact.split(email)[0]}
        <a href={`mailto:${email}`}>{email}</a>
      </p>

      <p className="text-sm text-muted-foreground">{p.updatedAt}</p>
    </main>
  );
}
