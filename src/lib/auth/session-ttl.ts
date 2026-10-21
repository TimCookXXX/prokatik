// Срок сессии — общий для всех способов входа: issueSession (VK, почта,
// dev-логин) и Auth.js (Яндекс, session.maxAge). Лист без зависимостей:
// его читает и edge-конфиг Auth.js, которому база недоступна.
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
