import Image from "next/image";
import { Clock, CalendarCheck, MapPin } from "lucide-react";
import { content } from "@theme/content";
import { ScrollRow } from "@/components/ui/ScrollRow";

/* «Как это работает» — четыре макета настоящих экранов сделки, а не абзацы
 * текста: сервис объясняется показом интерфейса.
 *
 * Всё внутри макетов — неинтерактивная разметка из div и span. Настоящих полей
 * и кнопок здесь быть не должно: это картинка, по ней не кликают, а сторож
 * полей (tests/theme/fields.test.ts) справедливо потребовал бы от них
 * контракта ui/field.ts. */

const STEP_CAPTIONS = content.home.howSteps;

// Мини-календарь шага 02: три недели сентября, выбраны 5–7, заняты 12–13.
const PICKED = new Set([5, 6, 7]);
const BUSY = new Set([12, 13]);

/* Карточка занимает две строки родительской сетки и берёт их через subgrid.
 * Так у всех карточек ряда общий трек под подпись: её высота считается по самой
 * длинной, и разделительная линия проходит на одном уровне. Сами по себе
 * подписи бывают в две строки и в три, и линия гуляла по вертикали на 20px. */
/* Ниже sm сетки нет — карточки идут лентой (см. ниже), и линию держит flex:
 * макет растягивается, подпись прижата к низу карточки одной высоты. */
function Card({ children, caption }: { children: React.ReactNode; caption: { step: string; text: string } }) {
  return (
    <li className="flex w-[80%] max-w-[300px] shrink-0 snap-start flex-col overflow-hidden rounded-lg border border-border bg-card sm:row-span-2 sm:grid sm:w-auto sm:max-w-none sm:grid-rows-subgrid">
      <div className="flex flex-1 flex-col gap-3 p-[18px]">{children}</div>
      <div className="border-t border-border px-[18px] py-3.5">
        <div className="font-mono text-micro uppercase tracking-mono text-accent">{caption.step}</div>
        <p className="mt-1.5 text-sm leading-[1.45] text-muted-foreground">{caption.text}</p>
      </div>
    </li>
  );
}

// Строка «подпись — значение» в макетах: слева служебное, справа значение.
function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={tone ?? "text-foreground"}>{value}</span>
    </div>
  );
}

// Чип статуса брони: охра — ждёт ответа, зелёный — подтверждена.
function StatusChip({ label, tone }: { label: string; tone: "accent" | "primary" }) {
  return (
    <span
      className={`shrink-0 rounded-sm border px-1.5 py-0.5 text-micro ${
        tone === "accent" ? "border-accent text-accent" : "border-primary text-primary"
      }`}
    >
      {label}
    </span>
  );
}

function MockHeader({ title, chip }: { title: string; chip: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="font-mono text-micro uppercase tracking-mono text-muted-foreground">
        {title}
      </span>
      {chip}
    </div>
  );
}

export function HowItWorks() {
  return (
    <section
      id="how"
      className="surface scroll-mt-[calc(var(--header-total)+16px)] p-4 sm:p-6 wide:p-11"
      style={{
        backgroundImage: [
          "radial-gradient(620px circle at 12% 0%, color-mix(in srgb, var(--color-primary) 7%, transparent), transparent 62%)",
          "radial-gradient(560px circle at 88% 100%, color-mix(in srgb, var(--color-accent) 6%, transparent), transparent 60%)",
        ].join(", "),
      }}
    >
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <h2 className="font-display text-2xl font-extrabold tracking-mark text-foreground">
          {content.home.howHeading}
        </h2>
        <p className="text-base text-muted-foreground">{content.home.howLead}</p>
      </div>

      {/* На телефоне — лента с прокруткой и привязкой к карточке, а не две
        * колонки: это макеты экранов, а не карточки выдачи — ужатые вдвое, они
        * перестают читаться как интерфейс, а столбиком занимали четыре экрана.
        * Лента от кромки до кромки панели; с именем и, пока прокручивается,
        * фокусируемая — листается и с клавиатуры (ScrollRow). С sm — прежняя
        * сетка, и остановки Tab на ней нет. */}
      <ScrollRow
        as="ol"
        aria-label={content.home.howStepsLabel}
        className="-mx-4 mt-6 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:mx-0 sm:mt-8 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 wide:grid-cols-4 [&::-webkit-scrollbar]:hidden"
      >
        {/* 01 — карточка вещи: цена, залог и свободные дни видны сразу. */}
        <Card caption={STEP_CAPTIONS[0]}>
          {/* Скругления по диагонали, как у ListingCard: крупные углы —
            * верхний левый и нижний правый. Порядок в CSS-записи макета
            * `20px 6px 20px 6px` — это TL, TR, BR, BL. */}
          <div className="relative aspect-[16/10] overflow-hidden rounded-tl-[20px] rounded-tr-[6px] rounded-br-[20px] rounded-bl-[6px] bg-muted">
            {/* Свой файл, а не /demo/*.webp: тот каталог живёт для db:seed и
              * однажды уедет вместе с ним, а главная от него зависеть не
              * должна. */}
            <Image
              src="/mock/listing.webp"
              alt=""
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
              className="object-cover"
            />
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground">Перфоратор Bosch</div>
            <div className="mt-0.5 flex items-baseline gap-1.5">
              <span className="font-mark text-xl font-bold tracking-mark text-foreground">500 ₽</span>
              <span className="text-xs text-muted-foreground">в сутки</span>
            </div>
          </div>
          <div className="flex flex-col gap-1.5 border-t border-border pt-2.5 text-xs">
            <Row label="Залог" value="3 000 ₽" />
            <Row label="Свободно" value="с 5 сентября" tone="text-primary" />
          </div>
        </Card>

        {/* 02 — выбор дней и телефон. Платить на этом шаге ничего не нужно. */}
        <Card caption={STEP_CAPTIONS[1]}>
          <div className="flex gap-1.5">
            {[
              { label: "С", value: "5 сен" },
              { label: "По", value: "7 сен" },
            ].map((f) => (
              <div key={f.label} className="flex-1 rounded-sm border border-border bg-muted px-2.5 py-2">
                <div className="text-micro text-muted-foreground">{f.label}</div>
                {/* В двух колонках на телефоне полю остаётся около 65px, и
                  * «5 сен» ломается пополам. Дата — одно значение, переносить
                  * её нечем. */}
                <div className="mt-0.5 whitespace-nowrap font-mark text-base font-medium text-foreground">
                  {f.value}
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: 21 }, (_, i) => i + 1).map((n) => (
              <span
                key={n}
                className={`flex h-[22px] items-center justify-center rounded-sm font-mark text-micro font-medium ${
                  PICKED.has(n)
                    ? "bg-primary text-primary-foreground"
                    : BUSY.has(n)
                      ? "bg-muted text-muted-foreground/70"
                      : "text-muted-foreground"
                }`}
              >
                {n}
              </span>
            ))}
          </div>

          <div className="rounded-sm border border-border bg-muted px-3 py-2.5 text-xs text-muted-foreground">
            +7 917 ··· ·· ··
          </div>
          <div className="mt-auto flex h-[38px] items-center justify-center rounded-sm bg-primary text-xs font-semibold text-primary-foreground">
            Забронировать
          </div>
        </Card>

        {/* 03 — что видит владелец: подтвердить или отклонить. */}
        <Card caption={STEP_CAPTIONS[2]}>
          <MockHeader title="Новая бронь" chip={<StatusChip label="ждёт ответа" tone="accent" />} />

          <div className="flex items-center gap-2.5 rounded-sm border border-border bg-muted p-2.5">
            <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-hover text-2xs text-muted-foreground">
              С
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-foreground">Сергей</span>
              <span className="block text-2xs text-muted-foreground">5–7 сентября · 1 шт</span>
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
            ответьте в течение суток
          </div>

          <div className="mt-auto flex gap-1.5">
            <div className="flex h-[38px] flex-1 items-center justify-center rounded-sm bg-primary text-xs font-semibold text-primary-foreground">
              Подтвердить
            </div>
            <div className="flex h-[38px] items-center justify-center rounded-sm border border-border px-3.5 text-xs text-muted-foreground">
              Отклонить
            </div>
          </div>
        </Card>

        {/* 04 — бронь подтверждена: появляется телефон владельца. */}
        <Card caption={STEP_CAPTIONS[3]}>
          <MockHeader title="Ваша бронь" chip={<StatusChip label="подтверждена" tone="primary" />} />

          <div className="rounded-sm border border-primary/35 bg-primary/[0.08] p-3">
            <div className="text-2xs text-muted-foreground">Телефон владельца</div>
            <div className="mt-1 font-mark text-xl font-medium text-foreground">+7 917 245-11-08</div>
          </div>

          <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <CalendarCheck className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
              5–7 сентября — ваши
            </div>
            <div className="flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              забрать: Ново-Савиновский
            </div>
          </div>
        </Card>
      </ScrollRow>
    </section>
  );
}
