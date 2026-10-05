import type { Metadata } from "next";
import { adminListCities, adminListGeoRegions } from "@/server/admin";
import { adminSetCityActive } from "@/server/actions/admin";
import { CityForm } from "@/components/admin/CityForm";
import { CityRow } from "@/components/admin/CityRow";
import { listingsCountLabel } from "@/lib/catalog/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Города — админка", robots: { index: false } };

export default async function AdminCitiesPage() {
  const [rows, geoRegions] = await Promise.all([adminListCities(), adminListGeoRegions()]);

  return (
    <section aria-label="Города" className="flex flex-col gap-6">
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Добавить город</h2>
        <CityForm geoRegions={geoRegions} />
      </div>

      <ul className="flex flex-col gap-2">
        {rows.map(({ city, listingCount }) => (
          <CityRow
            key={city.id}
            city={city}
            geoRegions={geoRegions}
            meta={`/${city.slug}${city.region ? ` · ${city.region}` : ""}` +
              `${city.geoRegion ? ` · геоданные ${city.geoRegion}` : ""} · ${listingsCountLabel(listingCount)}`}
            toggle={adminSetCityActive.bind(null, city.id, !city.isActive)}
          />
        ))}
      </ul>
    </section>
  );
}
