import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { content } from "@theme/content";
import { WEBVISOR_PRIVATE } from "@/components/analytics/webvisor";

export const metadata = {
  title: "Доступ ограничен",
  robots: { index: false, follow: false },
};

export default async function BannedPage() {
  const session = await auth();
  if (!session?.user?.bannedAt) redirect("/");

  return (
    <main className={`container mx-auto max-w-md py-16 px-4 flex flex-col items-center text-center ${WEBVISOR_PRIVATE}`}>
      <h1 className="text-2xl font-semibold mb-4">{content.banned.heading}</h1>
      <div className="rounded-lg border border-border bg-card p-6 w-full mb-6">
        <p className="text-sm text-muted-foreground mb-2">{content.banned.reasonLabel}</p>
        <p className="text-base">{session.user.banReason ?? content.banned.noReason}</p>
      </div>
      <p className="text-sm text-muted-foreground mb-6">{content.banned.contact}</p>
      <form action="/api/auth/signout" method="POST">
        <Button type="submit" variant="outline">{content.banned.logout}</Button>
      </form>
    </main>
  );
}
