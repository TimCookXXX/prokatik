import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAuthState } from "@/lib/auth/guard";
import { getActiveCities, getAllCategories } from "@/server/catalog";
import { getCitiesGeo, resolveOwnCity } from "@/server/city";
import { leafCategories } from "@/lib/owner/categories";
import { ListingForm } from "@/components/cabinet/ListingForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Новое объявление", robots: { index: false } };

export default async function NewListingPage() {
  const session = await requireAuthState();
  if (!session) redirect("/login?from=/cabinet");

  // Город предзаполняем «своим», а не тем, который человек сейчас листает:
  // вещь лежит там, где он живёт. Поле остаётся редактируемым.
  // Гео-контекст городов — без движка геокодера: по нему форма решает,
  // выбирать адрес из подсказок или писать текстом.
  const [cities, cats, ownCity, geo] = await Promise.all([
    getActiveCities(), getAllCategories(), resolveOwnCity(), getCitiesGeo(),
  ]);

  return (
    <main>
      <ListingForm
        mode="create"
        // Имя берём из сессии: лишнего запроса в БД не нужно.
        sellerName={session.user.name ?? ""}
        cities={cities.map((c) => ({ id: c.id, name: c.name, slug: c.slug, geo: geo.get(c.slug) ?? null }))}
        categories={leafCategories(cats)}
        initial={{
          title: "", cityId: ownCity?.id ?? "", categoryId: "", description: "",
          priceDay: "",
          depositType: "money", depositAmount: "", quantity: "1",
          handoverPickup: true, handoverDelivery: false,
          photos: [],
        }}
      />
    </main>
  );
}
