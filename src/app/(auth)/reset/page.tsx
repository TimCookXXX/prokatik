import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isResetTokenUsable } from "@/lib/auth/flows";
import { drizzleAuthStore } from "@/lib/auth/store";
import { content } from "@theme/content";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

export const dynamic = "force-dynamic";

// Служебная, как /login: noindex, ссылки проходимы.
export const metadata: Metadata = {
  title: "Восстановление пароля",
  robots: { index: false, follow: true },
};

export default async function ResetPage({
  searchParams,
}: {
  // В Next 15 searchParams — Promise.
  searchParams: Promise<{ token?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/");

  const { token } = await searchParams;
  // Токен проверяем до отрисовки формы, чтобы человек не вводил пароль впустую.
  const usable = token ? await isResetTokenUsable(drizzleAuthStore(), token) : false;

  return (
    <main className="container mx-auto flex min-h-[calc(100vh-14rem)] max-w-md flex-col items-center justify-center px-4 py-12">
      <div className="w-full">
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 mb-4 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {content.auth.loginTitle}
        </Link>
        <div className="w-full rounded-lg border border-border bg-card p-8">
          <h1 className="font-display text-2xl text-center mb-6">Новый пароль</h1>
          {usable && token
            ? <ResetPasswordForm token={token} />
            : (
              <p className="text-sm text-muted-foreground text-center">
                Ссылка недействительна или устарела. Запросите новую на странице входа.
              </p>
            )}
        </div>
      </div>
    </main>
  );
}
