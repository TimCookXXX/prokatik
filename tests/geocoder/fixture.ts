// Маленький индекс для тестов геокодера: Краснодар (с микрорайоном Юбилейный), Яблоновский, Новая Адыгея,
// СНТ Кубаночка. Координаты правдоподобные, но вымышленные.

import type { GeoIndexData, IndexHouse, IndexStreet } from "@/lib/geocoder/types";

const houses: IndexHouse[] = [];
const streets: IndexStreet[] = [];

function street(id: string, placeId: string, name: string, type: string, lat: number, lon: number, nums: string[], aliases: string[] = []) {
  streets.push({ id, placeId, name, type, aliases, lat, lon, houses: nums.length });
  nums.forEach((number, i) => {
    // дома вдоль улицы: чётные и нечётные — по разные стороны, шаг ~40 м
    const n = parseInt(number, 10) || i;
    houses.push({
      streetId: id, placeId, number, lat: lat + (n % 2 ? 0.0002 : -0.0002), lon: lon + n * 0.00025,
      precision: "house", source: "osm",
    });
  });
}

street("s-krasnaya", "p-krd", "улица Красная", "улица", 45.035, 38.975, ["118", "120", "122", "15А"], ["Красная улица"]);
street("s-baz-krd", "p-krd", "улица Базовская", "улица", 45.025, 38.984, ["2", "4", "21"]);
street("s-baz-yab", "p-yab", "улица Базовская", "улица", 45.0105, 38.9363, ["19", "21к1", "21с5", "23"]);
street("s-stavr", "p-krd", "улица Ставропольская", "улица", 45.019, 38.99, ["100", "102", "104", "108", "110", "101", "103"]);
street("s-40let", "p-krd", "улица 40 лет Победы", "улица", 45.054, 38.994, ["10", "12", "14"]);
street("s-1maya", "p-krd", "улица 1 Мая", "улица", 45.036, 39.116, ["3", "5", "7"]);
street("s-lin1", "p-krd", "1-й Линейный проезд", "проезд", 45.07, 38.95, ["1", "2"]);
street("s-lin2", "p-krd", "2-й Линейный проезд", "проезд", 45.071, 38.951, ["1", "2", "3"]);
street("s-averk", "p-krd", "улица Героя Аверкиева", "улица", 45.06, 39.03, ["6", "8"]);
street("s-kubnab", "p-krd", "улица Кубано-Набережная", "улица", 45.01, 38.99, ["5", "7"]);
street("s-vishn-krd", "p-krd", "улица Вишнёвая", "улица", 45.1, 38.95, ["3", "5", "7"]);
street("s-vishn-snt", "p-kub", "улица Вишнёвая", "улица", 45.13, 39.05, ["3", "5"]);
street("s-sad-yab", "p-yab", "улица Садовая", "улица", 44.995, 38.948, ["1", "3", "5"]);
street("s-sad-na", "p-na", "улица Садовая", "улица", 45.012, 38.943, ["1", "3"]);
street("s-kolc-ul", "p-krd", "улица Кольцевая", "улица", 45.08, 38.99, ["9", "11"]);
street("s-kolc-pr", "p-krd", "Кольцевой проезд", "проезд", 45.085, 38.995, ["9", "11"]);
street("s-krup", "p-krd", "улица Крупской", "улица", 45.023, 39.12, ["123", "125", "125/1", "125/2", "125/3", "127"]);
street("s-chuk", "p-krd", "улица Чукотская", "улица", 45.103, 39.041, ["21", "23к1", "23к2", "25"]);
street("s-nik-kond", "p-krd", "улица Николая Кондратенко", "улица", 45.014, 38.964, ["4", "6с1", "6с2"]);
street("s-nikolaev", "p-krd", "улица Николаевская", "улица", 45.2, 39.2, ["1"]);
street("s-zar1", "p-krd", "улица 1-я Заречная", "улица", 45.026, 39.084, ["1", "3"]);
street("s-zar1pr", "p-krd", "1-й Заречный проезд", "проезд", 45.024, 39.072, ["1", "3"]);

export const FIXTURE: GeoIndexData = {
  version: "test",
  citySlug: "krasnodar",
  builtAt: "2026-09-30T00:00:00Z",
  places: [
    { id: "p-krd", name: "Краснодар", kind: "city", aliases: ["г. Краснодар"], parentId: null, lat: 45.0355, lon: 38.9753 },
    { id: "p-yub", name: "Юбилейный", kind: "microdistrict", aliases: ["ЮМР", "Юбилейка"], parentId: "p-krd", lat: 45.031, lon: 38.9124 },
    { id: "p-yab", name: "Яблоновский", kind: "town", aliases: ["пгт Яблоновский"], parentId: null, lat: 44.988, lon: 38.9475 },
    { id: "p-na", name: "Новая Адыгея", kind: "village", aliases: [], parentId: null, lat: 45.025, lon: 38.938 },
    { id: "p-kub", name: "СНТ Кубаночка", kind: "snt", aliases: ["Кубаночка"], parentId: null, lat: 45.13, lon: 39.05 },
  ],
  streets,
  houses,
  pois: [
    { id: "o-gal", name: "ТЦ Галерея", kind: "mall", aliases: ["Галерея Краснодар"], placeId: "p-krd", lat: 45.0404, lon: 38.9767, address: "улица Головатого, 313" },
  ],
};

export const KRD_CENTER = { lat: 45.0355, lon: 38.9753 };
