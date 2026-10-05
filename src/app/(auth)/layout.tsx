// Обёртка страниц входа и сброса пароля: прячет их от записей Вебвизора.

import { WEBVISOR_PRIVATE } from "@/components/analytics/webvisor";

export default function AuthAreaLayout({ children }: { children: React.ReactNode }) {
  return <div className={WEBVISOR_PRIVATE}>{children}</div>;
}
