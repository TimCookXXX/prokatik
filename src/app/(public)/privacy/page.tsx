import type { Metadata } from "next";
import { content } from "@theme/content";
import { siteUrl } from "@/lib/site-config";

// Функция, а не объект: адрес сайта читается при запросе, а не при импорте.
export function generateMetadata(): Metadata {
  return {
    title: "Политика конфиденциальности",
    description: content.privacy.intro,
    alternates: { canonical: `${siteUrl()}/privacy` },
  };
}

export default function PrivacyPage() {
  const p = content.privacy;
  const email = content.site.contactEmail;
  return (
    <main className="container mx-auto max-w-2xl py-12 px-4 prose prose-neutral dark:prose-invert">
      <h1>{p.title}</h1>
      <p>{p.intro}</p>

      <h2>{p.section.whoWeAre}</h2>
      <p>{p.section.whoWeAreBody}</p>

      <h2>{p.section.whatWeCollect}</h2>
      <p>{p.section.whatWeCollectBody}</p>

      <h2>{p.section.cookies}</h2>
      <p>{p.section.cookiesBody}</p>

      <h2>{p.section.delete}</h2>
      <p>{p.section.deleteBody}</p>

      <h2>{p.section.contact}</h2>
      <p>
        {p.contact.split(email)[0]}
        <a href={`mailto:${email}`}>{email}</a>
      </p>

      <p className="text-sm text-muted-foreground">{p.updatedAt}</p>
    </main>
  );
}
