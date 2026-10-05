import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { buildEdgeConfig } from "@/lib/auth/config.edge";
import { getEnv } from "@/lib/env";
import { redirect } from "next/navigation";
import { content } from "@theme/content";
import { AuthPanel } from "@/components/auth/AuthPanel";
import { mailTransportAvailable } from "@/lib/mail/mailer";
import { safeCallback } from "@/lib/auth/session";

// Страница входа — служебная: в индекс не идёт, но ссылки с неё робот
// проходит. Не Disallow в robots.txt: тогда робот не прочитал бы noindex, а
// Google держал бы голый адрес в индексе по ссылкам с каждой страницы.
export const metadata: Metadata = {
  title: "Вход",
  robots: { index: false, follow: true },
};

// Тексты ошибок, с которыми сюда редиректят OAuth-роуты и подтверждение почты.
const ERRORS: Record<string, string> = {
  OAuthAccountNotLinked: "У этой почты уже есть вход по паролю — войдите паролем",
  email_taken: "Эта почта уже занята другим способом входа",
  verify_token_invalid: "Ссылка недействительна или устарела — запросите новую",
};

export default async function LoginPage({
  searchParams,
}: {
  // В Next 15 searchParams — Promise.
  searchParams: Promise<{ error?: string; from?: string }>;
}) {
  const session = await auth();
  // Забаненного тоже уводим на главную — про блокировку ему скажет /banned,
  // куда его отправит гард на первом же закрытом разделе.
  if (session?.user) redirect("/");

  const config = buildEdgeConfig();
  const nextAuthProviders = (config.providers ?? []).flatMap((p) => {
    const id = (p as { id?: string }).id;
    return id ? [id] : [];
  });

  const env = getEnv();
  const vkEnabled = Boolean(env.VK_CLIENT_ID && env.VK_CLIENT_SECRET);
  const hasAny = nextAuthProviders.length > 0 || vkEnabled;

  // Вход по паролю доступен всегда, регистрация и сброс — только при рабочем
  // почтовом транспорте: без письма их всё равно не завершить.
  const canRegister = mailTransportAvailable();
  const { error, from } = await searchParams;
  const errorText = error ? ERRORS[error] ?? null : null;
  // Сюда приземляют middleware и гарды кабинета с ?from=/cabinet — после входа
  // возвращаем человека туда, куда он шёл, а не на главную.
  const callbackUrl = safeCallback(from);

  // /login без FeedShell — это самостоятельная страница входа. Центрируем
  // карточку по обеим осям через flex на <main>. Над карточкой — back-link
  // на главную (анону больше некуда вернуться), не Button чтобы пасть в типизацию
  // <Link href>.
  return (
    <main className="container mx-auto flex min-h-[calc(100vh-14rem)] max-w-md flex-col items-center justify-center px-4 py-12">
      <div className="w-full">
        <div className="w-full rounded-lg border border-border bg-card p-8">
          {errorText && (
            <p className="mb-6 rounded-sm border border-border bg-muted/40 px-3 py-2 text-sm text-destructive">
              {errorText}
            </p>
          )}
          <AuthPanel
            nextAuthProviders={nextAuthProviders}
            vkEnabled={vkEnabled}
            canRegister={canRegister}
            callbackUrl={callbackUrl}
            homeHref="/"
          />
          {!hasAny && !canRegister && (
            <p className="mt-4 text-sm text-muted-foreground text-center">{content.auth.noProviders}</p>
          )}
        </div>
      </div>
    </main>
  );
}
