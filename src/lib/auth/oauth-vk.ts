import { createHash, randomBytes } from "node:crypto";
import { getEnv } from "@/lib/env";
import { siteUrl } from "@/lib/site-config";
import { drizzleAuthStore, type AuthStore } from "@/lib/auth/store";
import { sessionTtlSeconds } from "@/lib/auth/session";

// Выдача сессии и имя cookie общие с остальными способами входа — живут в session.ts.
export { sessionCookieName, sessionTtlSeconds } from "@/lib/auth/session";

export const VK_AUTHORIZE_URL = "https://id.vk.com/authorize";
export const VK_TOKEN_URL = "https://id.vk.com/oauth2/auth";
export const VK_USERINFO_URL = "https://id.vk.com/oauth2/user_info";

export const COOKIE_VERIFIER = "oauth-vk-verifier";
export const COOKIE_STATE = "oauth-vk-state";
export const COOKIE_CALLBACK = "oauth-vk-callback";

const PKCE_TTL_SECONDS = 10 * 60;

export type VkSubProvider = "vkid" | "mail_ru" | "ok_ru";

export function isVkSubProvider(v: string | null | undefined): v is VkSubProvider {
  return v === "vkid" || v === "mail_ru" || v === "ok_ru";
}

export function vkCallbackUrl(): string {
  return `${siteUrl()}/api/oauth/vk/callback`;
}

export const pkceTtlSeconds = PKCE_TTL_SECONDS;

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function generateState(): string {
  return randomBytes(16).toString("hex");
}

export function buildAuthorizeUrl(opts: {
  state: string;
  codeChallenge: string;
  subProvider: VkSubProvider;
}): string {
  const env = getEnv();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.VK_CLIENT_ID!,
    redirect_uri: vkCallbackUrl(),
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
    scope: "email",
  });
  if (opts.subProvider !== "vkid") {
    params.set("provider", opts.subProvider);
  }
  return `${VK_AUTHORIZE_URL}?${params.toString()}`;
}

export type VkProfile = {
  user_id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  avatar: string | null;
};

type VkTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
};

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export async function exchangeCode(opts: {
  code: string;
  codeVerifier: string;
  deviceId: string;
  state: string;
}): Promise<VkTokens> {
  const env = getEnv();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code_verifier: opts.codeVerifier,
    redirect_uri: vkCallbackUrl(),
    code: opts.code,
    client_id: env.VK_CLIENT_ID!,
    device_id: opts.deviceId,
    state: opts.state,
  });
  const res = await fetch(VK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`VK token exchange failed: ${res.status} ${text}`);
  const json = JSON.parse(text) as Record<string, unknown>;
  const accessToken = asString(json.access_token);
  if (!accessToken) throw new Error(`VK token exchange returned no access_token: ${text}`);
  return {
    accessToken,
    refreshToken: asString(json.refresh_token),
    expiresIn: asNumber(json.expires_in),
  };
}

export async function fetchUserInfo(accessToken: string): Promise<VkProfile> {
  const env = getEnv();
  const body = new URLSearchParams({
    access_token: accessToken,
    client_id: env.VK_CLIENT_ID!,
  });
  const res = await fetch(VK_USERINFO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`VK user_info failed: ${res.status} ${text}`);
  const json = JSON.parse(text) as Record<string, unknown>;
  const u = json.user as Record<string, unknown> | undefined;
  const userId = u ? asString(u.user_id) ?? (typeof u.user_id === "number" ? String(u.user_id) : null) : null;
  if (!userId) throw new Error(`VK user_info missing user.user_id: ${text}`);
  return {
    user_id: userId,
    email: u ? asString(u.email) : null,
    first_name: u ? asString(u.first_name) : null,
    last_name: u ? asString(u.last_name) : null,
    avatar: u ? asString(u.avatar) : null,
  };
}

export type VkUpsertResult =
  | { ok: true; sessionToken: string; expires: Date }
  | { ok: false; reason: "email_taken" };

// Склейки по e-mail здесь больше нет. Раньше юзер с совпадающим адресом
// подшивался к VK-аккаунту — вместе с паролями это стало вектором захвата:
// аккаунт с подтверждённой почтой …@mail.ru перехватывался входом через
// VK-шлюз с sub-провайдером mail_ru. Теперь ищем только по строке в accounts,
// а занятый адрес — понятный отказ. Уже склеенные аккаунты не затронуты.
export async function upsertUserAndSession(opts: {
  profile: VkProfile;
  tokens: VkTokens;
  store?: AuthStore;
}): Promise<VkUpsertResult> {
  const store = opts.store ?? drizzleAuthStore();
  const { profile, tokens } = opts;

  const existingUserId = await store.findUserIdByAccount("vk", profile.user_id);
  if (existingUserId) {
    return { ok: true, ...await store.issueSession(existingUserId) };
  }

  const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim() || null;
  const created = await store.createUserWithAccount({
    email: profile.email ?? `vk-${profile.user_id}@vk.placeholder`,
    name: fullName,
    image: profile.avatar,
    provider: "vk",
    providerAccountId: profile.user_id,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresIn ? Math.floor(Date.now() / 1000) + tokens.expiresIn : null,
    scope: "email",
  });
  if (!created.ok) return { ok: false, reason: "email_taken" };

  return { ok: true, ...await store.issueSession(created.userId) };
}
