// Обёртка всех личных зон: кабинет, переписка, профиль, админка. Её единственная
// задача — спрятать содержимое от записей Вебвизора.

import { WEBVISOR_PRIVATE } from "@/components/analytics/webvisor";

export default function PrivateAreaLayout({ children }: { children: React.ReactNode }) {
  return <div className={WEBVISOR_PRIVATE}>{children}</div>;
}
