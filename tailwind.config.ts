import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";
import typography from "@tailwindcss/typography";

// Цвета лежат в --color-* как чистый hex (IDE подсвечивает превью).
// Альфу подмешиваем через color-mix — Tailwind подставит <alpha-value> в момент сборки.
const c = (name: string) =>
  `color-mix(in srgb, var(${name}) calc(<alpha-value> * 100%), transparent)`;

export default {
  // На тач-устройствах :hover залипает после тапа до следующего касания.
  // Чем заметнее ховер, тем заметнее артефакт — а мы его усиливаем.
  future: { hoverOnlyWhenSupported: true },
  content: ["./src/**/*.{ts,tsx}", "./theme/**/*.{ts,tsx}"],
  darkMode: ["class"],
  theme: {
    // Шкала скруглений заменена целиком, а не расширена: дефолтные ключи
    // Tailwind (md, xl, 2xl, 3xl) убраны намеренно, иначе случайный
    // rounded-2xl молча заводит в проект третий радиус. Живых значения два —
    // см. --radius-* в theme/tokens.css.
    borderRadius: {
      none: "0",
      sm: "var(--radius-sm)",
      lg: "var(--radius-lg)",
      pill: "var(--radius-pill)",
      // Круг: аватары, иконочные кружки, счётчики.
      full: "9999px",
    },
    extend: {
      // Широкая раскладка главной — с 1120px, точка из макета, одна на все её
      // секции: с разными точками полоса 1024–1279 разъезжалась бы
      // посекционно (ListYourItemBand уже в две колонки, лента новых
      // объявлений ещё в две вместо четырёх). Дефолтные брейкпоинты Tailwind
      // остаются нетронутыми.
      screens: { wide: "1120px" },
      colors: {
        background: c("--color-background"),
        foreground: c("--color-foreground"),
        header: c("--color-header"),
        primary: {
          DEFAULT:    c("--color-primary"),
          foreground: c("--color-primary-fg"),
        },
        accent: {
          DEFAULT:    c("--color-accent"),
          foreground: c("--color-accent-fg"),
        },
        card: {
          DEFAULT:    c("--color-card"),
          foreground: c("--color-card-fg"),
        },
        muted: {
          DEFAULT:    c("--color-muted"),
          foreground: c("--color-muted-fg"),
        },
        border: c("--color-border"),
        ring:   c("--color-ring"),
        destructive: c("--color-danger"),
        // Состояния идут МИМО c(): токен уже полупрозрачный, и обёртка дала бы
        // вложенный color-mix, где bg-hover/50 значит не то, что читается.
        hover: "var(--color-hover)",
        selected: {
          DEFAULT: "var(--color-selected)",
          foreground: "var(--color-selected-fg)",
        },
      },
      fontFamily: {
        display: "var(--font-display)",
        sans: "var(--font-text)",
        // Знак и деньги.
        mark: "var(--font-mark)",
        // Служебные капсы.
        mono: "var(--font-mono)",
      },
      fontSize: {
        micro: "var(--text-micro)",
        "2xs": "var(--text-2xs)",
        xs:   "var(--text-xs)",
        sm:   "var(--text-sm)",
        base: "var(--text-base)",
        lg:   "var(--text-lg)",
        xl:   "var(--text-xl)",
        "2xl": "var(--text-2xl)",
        "3xl": "var(--text-3xl)",
        // Две ступени сверх ряда, обе только на главной. Своими именами, а не
        // 4xl/5xl: шкала кеглей идёт через extend, дефолтные ключи Tailwind
        // живы, и text-4xl уже набирает «404» в not-found.tsx.
        band: "var(--text-band)",
        hero: "var(--text-hero)",
      },
      lineHeight: {
        tight: "var(--leading-tight)",
        snug:  "var(--leading-snug)",
        body:  "var(--leading-body)",
      },
      letterSpacing: {
        display: "var(--tracking-display)",
        mark:    "var(--tracking-mark)",
        mono:    "var(--tracking-mono)",
      },
      // Кант выбранного не влезает в форму { DEFAULT, foreground } у цвета,
      // поэтому регистрируется отдельно — иначе border-selected не появится.
      borderColor: {
        selected: "var(--color-selected-border)",
      },
      // Единственная своя анимация в проекте: три точки индикатора «печатает…».
      // Применяется через motion-safe:, поэтому под prefers-reduced-motion гаснет.
      keyframes: {
        "chat-dot": {
          "0%, 60%, 100%": { opacity: ".25", transform: "translateY(0)" },
          "30%": { opacity: "1", transform: "translateY(-2px)" },
        },
      },
      animation: {
        "chat-dot": "chat-dot 1.2s infinite",
      },
    },
  },
  plugins: [animate, typography],
} satisfies Config;
