import type { Metadata, Route } from "next";
import Link from "next/link";
import { content } from "@theme/content";
import { adminListUsers } from "@/server/admin";
import { analyticsHref } from "@/lib/analytics/admin-filters";
import { adminBanUser, adminUnbanUser, adminSetUserVerified } from "@/server/actions/admin";
import { ActionButton } from "@/components/admin/ActionButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Пользователи — админка", robots: { index: false } };

export default async function AdminUsersPage() {
  const rows = await adminListUsers();

  return (
    <section aria-label="Пользователи">
      <p className="mb-4 text-sm text-muted-foreground">Последние {rows.length} пользователей</p>
      <ul className="flex flex-col gap-2">
        {rows.map(({ user, listingCount, requestCount, deviceCount }) => (
          <li key={user.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-3">
            <div className="min-w-0">
              <span className="font-medium">{user.name ?? "—"}</span>
              <span className="ml-2 text-sm text-muted-foreground">{user.email}</span>
              {user.isVerified && (
                <span className="ml-2 rounded-sm bg-accent/10 px-2 py-0.5 text-xs text-accent">проверен</span>
              )}
              {user.role !== "user" && (
                <span className="ml-2 rounded-sm bg-muted px-2 py-0.5 text-xs text-muted-foreground">{user.role}</span>
              )}
              {user.bannedAt && (
                <span className="ml-2 rounded-sm bg-destructive/15 px-2 py-0.5 text-xs">забанен</span>
              )}
              <p className="text-sm text-muted-foreground">
                {user.email} · {listingCount} объявл. · {requestCount} заявок · с {user.createdAt.toLocaleDateString("ru-RU")}
                {user.banReason ? ` · причина бана: ${user.banReason}` : ""}
              </p>
              {/* Устройства — браузеры своей статистики после входа в аккаунт. */}
              {deviceCount > 0 && (
                <Link
                  href={analyticsHref("/admin/visitors", { user: user.id }) as Route}
                  className="text-sm underline underline-offset-2 hoverable hover:text-foreground"
                >
                  {content.adminAnalytics.users.devices(String(deviceCount))}
                </Link>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <ActionButton
                label={user.isVerified ? "Снять проверку" : "Проверить"}
                variant="ghost"
                action={adminSetUserVerified.bind(null, user.id, !user.isVerified)}
              />
              {user.bannedAt ? (
                <ActionButton
                  label="Разбанить"
                  confirmText="Разблокировать пользователя?"
                  action={adminUnbanUser.bind(null, user.id)}
                />
              ) : (
                <ActionButton
                  label="Забанить"
                  promptText="Причина блокировки (минимум 5 символов):"
                  variant="ghost"
                  action={adminBanUser.bind(null, user.id)}
                />
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
