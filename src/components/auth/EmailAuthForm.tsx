"use client";

import { useState, useTransition } from "react";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { Button } from "@/components/ui/button";
import { field } from "@/components/ui/field";
import { WEBVISOR_NO_KEYS } from "@/components/analytics/webvisor";
import { PasswordInput } from "@/components/ui/PasswordInput";
import {
  checkEmailDomain, login, register, requestReset, resendVerificationEmail,
} from "@/server/actions/auth-email";

const INPUT = `${field} h-11 w-full px-5`;

type Mode = "login" | "register" | "forgot";

export function EmailAuthForm({
  canRegister,
  callbackUrl = "/",
}: {
  // Регистрация и сброс доступны только при рабочем почтовом транспорте.
  // Вход остаётся всегда: проверка пароля письма не требует.
  canRegister: boolean;
  callbackUrl?: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [domainError, setDomainError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [pending, startTransition] = useTransition();
  // Отдельный транзишен: «Отправить письмо ещё раз» соседствует с основной
  // кнопкой, и с общим флагом лоадер горел бы на обеих сразу.
  const [resendPending, startResend] = useTransition();

  const switchTo = (next: Mode) => {
    setMode(next);
    setError(null);
    setDomainError(null);
    setNeedsVerification(false);
  };

  // Заранее в форме про стоп-лист ничего не написано — строка появляется только
  // когда человек ввёл такой адрес. Список при этом остаётся на сервере.
  const checkDomain = () => {
    if (mode !== "register" || !email.includes("@")) return;
    startTransition(async () => {
      const res = await checkEmailDomain(email);
      setDomainError(res.blocked ? res.message : null);
    });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNeedsVerification(false);

    startTransition(async () => {
      if (mode === "register") {
        if (password !== password2) { setError("Пароли не совпадают"); return; }
        const res = await register({ email, password, name, callbackUrl });
        if (res.ok) setSentTo(res.data.sentTo);
        else setError(res.error);
        return;
      }

      if (mode === "forgot") {
        await requestReset(email);
        // Ответ всегда одинаковый — форма не должна работать проверялкой аккаунтов.
        setSentTo(email);
        return;
      }

      const res = await login({ email, password, callbackUrl });
      // Путь приходит из рантайма и уже пропущен через safeCallback на сервере,
      // а typedRoutes ждёт литерал — отсюда приведение.
      if (res.ok) { router.push(res.data.redirectTo as Route); router.refresh(); return; }
      setError(res.error);
      setNeedsVerification(res.code === "email_not_verified");
    });
  };

  const resend = () => {
    startResend(async () => {
      await resendVerificationEmail(email, callbackUrl);
      setResent(true);
    });
  };

  if (sentTo) {
    return (
      <div className="flex flex-col gap-4 text-sm">
        {/* Возврат к форме с сохранёнными значениями: письмо могло уйти на
          * адрес с опечаткой, и человеку нужно это поправить, а не гадать. */}
        <button
          type="button"
          onClick={() => { setSentTo(null); setResent(false); }}
          className="-ml-1 inline-flex w-fit items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {mode === "forgot" ? "Другой адрес" : "Изменить адрес"}
        </button>

        <p className="text-foreground">
          {mode === "forgot"
            ? <>Если почта <span className="font-medium">{sentTo}</span> зарегистрирована, мы отправили на неё ссылку для смены пароля.</>
            : <>Письмо отправлено на <span className="font-medium">{sentTo}</span>. Откройте ссылку из него, чтобы завершить регистрацию.</>}
        </p>
        {mode === "register" && (
          <Button type="button" variant="outline" pending={resendPending} disabled={resent} onClick={resend}>
            {resent ? "Письмо отправлено ещё раз" : "Отправить письмо ещё раз"}
          </Button>
        )}
        <button type="button" className="text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => { setSentTo(null); setResent(false); switchTo("login"); }}>
          Вернуться ко входу
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className={`flex flex-col gap-3 ${WEBVISOR_NO_KEYS}`}>
      <label className="flex flex-col gap-1 text-sm">
        Почта
        <input
          type="email" required autoComplete="email" value={email} className={INPUT}
          placeholder="pochta@example.ru"
          onChange={(e) => { setEmail(e.target.value); setDomainError(null); }}
          onBlur={checkDomain}
        />
      </label>
      {domainError && <p className="text-sm text-destructive">{domainError}</p>}

      {mode === "register" && (
        <label className="flex flex-col gap-1 text-sm">
          Имя
          {/* Имя видят те, с кем человек договаривается: владелец в заявке и
            * покупатели на витрине. У входа через Яндекс и VK оно приходит от
            * провайдера, здесь спрашиваем сами. */}
          <input
            type="text" required maxLength={100} autoComplete="name" className={INPUT}
            placeholder="Как вас зовут"
            value={name} onChange={(e) => setName(e.target.value)}
          />
        </label>
      )}

      {mode !== "forgot" && (
        <label className="flex flex-col gap-1 text-sm">
          Пароль
          {/* key: вход и регистрация делят одну позицию в дереве, и без ключа
            * включённый глазок переезжал бы между режимами вместе с полем.
            * Показ пароля — действие в моменте, при смене режима прячем. */}
          <PasswordInput
            key={mode}
            required minLength={8} className={INPUT}
            placeholder={mode === "register" ? "Не короче 8 символов" : "Ваш пароль"}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            value={password} onChange={(e) => setPassword(e.target.value)}
          />
        </label>
      )}

      {mode === "register" && (
        <label className="flex flex-col gap-1 text-sm">
          Повторите пароль
          <PasswordInput required minLength={8} autoComplete="new-password" className={INPUT}
            placeholder="Тот же пароль ещё раз"
            value={password2} onChange={(e) => setPassword2(e.target.value)} />
        </label>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      {needsVerification && (
        <Button type="button" variant="outline" pending={resendPending} disabled={resent} onClick={resend}>
          {resent ? "Письмо отправлено" : "Отправить письмо ещё раз"}
        </Button>
      )}

      <Button type="submit" pending={pending} disabled={Boolean(domainError)}>
        {mode === "login" ? "Войти" : mode === "register" ? "Зарегистрироваться" : "Отправить ссылку"}
      </Button>

      <div className="flex flex-wrap justify-between gap-2 text-sm text-muted-foreground">
        {mode === "login" ? (
          <>
            {canRegister && (
              <button type="button" className="hover:text-foreground transition-colors" onClick={() => switchTo("register")}>
                Регистрация
              </button>
            )}
            {canRegister && (
              <button type="button" className="hover:text-foreground transition-colors" onClick={() => switchTo("forgot")}>
                Забыли пароль?
              </button>
            )}
          </>
        ) : (
          <button type="button" className="hover:text-foreground transition-colors" onClick={() => switchTo("login")}>
            Уже есть аккаунт — войти
          </button>
        )}
      </div>
    </form>
  );
}
