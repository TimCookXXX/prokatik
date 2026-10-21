// Админка, только role=admin. Проверка здесь — не гарантия: layout Next не
// перерисовывает при переходах внутри сегмента (см. src/lib/auth/guard.ts).
// Данные защищают сами чтения src/server/admin.ts (assertAdmin) и actions
// src/server/actions/admin.ts (requireAdmin).

import { assertAdmin } from "@/lib/auth/assert-admin";
import { AccountShell } from "@/components/account/AccountShell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await assertAdmin();

  return (
    <AccountShell
      groups={[
        {
          title: "модерация",
          items: [
            { href: "/admin/listings", label: "Объявления" },
            { href: "/admin/requests", label: "Заявки" },
            { href: "/admin/users", label: "Пользователи" },
          ],
        },
        {
          title: "справочники",
          items: [
            { href: "/admin/cities", label: "Города" },
            { href: "/admin/categories", label: "Категории" },
          ],
        },
      ]}
    >
      {children}
    </AccountShell>
  );
}
