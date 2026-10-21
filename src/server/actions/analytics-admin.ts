"use server";

// Мутации раздела «Аналитика» в админке. Action доступен по сети напрямую,
// поэтому роль проверяется здесь, а вход — zod'ом.

import { z } from "zod";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { auth } from "@/lib/auth";
import { visitors } from "@db/schema";
import { isVisitorId } from "@/lib/analytics/visitor-cookie";

export type AnalyticsAdminResult = { ok: true } | { ok: false; error: string };

async function requireAdmin(): Promise<boolean> {
  const session = await auth();
  return Boolean(session?.user?.id && session.user.role === "admin");
}

const internalSchema = z.object({
  visitorId: z.string().refine(isVisitorId),
  internal: z.boolean(),
});

/**
 * «Это я — скрыть»: заходы браузера — свои и в сводку, таблицу и «Поиски» не
 * попадают. Пометка переходит на следующие id браузера (вход, выход) сама —
 * её наследует роут сбора. Обратное действие возвращает браузер в статистику.
 */
export async function adminSetVisitorInternal(visitorId: unknown, internal: unknown): Promise<AnalyticsAdminResult> {
  if (!(await requireAdmin())) return { ok: false, error: "forbidden" };
  const parsed = internalSchema.safeParse({ visitorId, internal });
  if (!parsed.success) return { ok: false, error: "invalid_input" };

  const res = await getDb().update(visitors)
    .set({ isInternal: parsed.data.internal })
    .where(eq(visitors.id, parsed.data.visitorId.toLowerCase()))
    .returning({ id: visitors.id });
  if (res.length === 0) return { ok: false, error: "not_found" };

  revalidatePath("/admin/visitors", "layout");
  revalidatePath("/admin/searches");
  return { ok: true };
}
