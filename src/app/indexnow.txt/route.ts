import { getEnv } from "@/lib/env";

// Ключ IndexNow по фиксированному адресу (keyLocation в src/lib/indexnow.ts).
// force-dynamic: без него Next пререндерил бы ответ при сборке, и ключ застыл бы
// тем, что было в окружении сборки, — а он задаётся только в .env прода.
export const dynamic = "force-dynamic";

const TEXT = { "Content-Type": "text/plain; charset=utf-8" };

export function GET(): Response {
  const key = getEnv().INDEXNOW_KEY;
  if (!key) return new Response("Not Found\n", { status: 404, headers: TEXT });
  return new Response(key, { headers: TEXT });
}
