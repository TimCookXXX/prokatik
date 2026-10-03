import type { Metadata } from "next";
import { content } from "@theme/content";

// Как /privacy: индексируется, в sitemap не входит.
export const metadata: Metadata = {
  title: content.sources.title,
  description: content.sources.intro,
};

const link = "underline underline-offset-2 transition-colors hover:text-accent";
const heading = "mt-8 font-display text-lg font-semibold";
const body = "mt-2 leading-relaxed";

export default function SourcesPage() {
  const s = content.sources;
  const email = content.site.contactEmail;
  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-12 pt-8 text-foreground">
      <h1 className="font-display text-2xl font-bold">{s.title}</h1>
      <p className="mt-3 leading-relaxed text-muted-foreground">{s.intro}</p>

      <section>
        <h2 className={heading}>{s.osm.heading}</h2>
        <p className={body}>
          {s.osm.body}{" "}
          <a href={s.osm.creditHref} target="_blank" rel="noopener noreferrer" className={link}>
            {s.osm.credit}
          </a>
          , {s.osm.license}
        </p>
      </section>

      <section>
        <h2 className={heading}>{s.gar.heading}</h2>
        <p className={body}>{s.gar.body}</p>
      </section>

      <section>
        <h2 className={heading}>{s.database.heading}</h2>
        <p className={body}>
          {s.database.body}{" "}
          <a href={s.database.licenseHref} target="_blank" rel="noopener noreferrer" className={link}>
            {s.database.license}
          </a>
          .
        </p>
        <p className={body}>
          {s.database.offer}{" "}
          <a href={`mailto:${email}`} className={`${link} break-all`}>
            {email}
          </a>
          .
        </p>
      </section>
    </main>
  );
}
