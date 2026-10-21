"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { field } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { changeAccountPassword } from "@/server/actions/auth-email";

const INPUT = `${field} h-11 px-3`;

// Смена пароля из профиля. Показывается только аккаунтам с паролем —
// страница профиля проверяет это по users.password_hash.
export function ChangePasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [next2, setNext2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next !== next2) { setError("Пароли не совпадают"); return; }

    startTransition(async () => {
      const res = await changeAccountPassword({ currentPassword: current, newPassword: next });
      if (!res.ok) { setError(res.error); return; }
      setDone(true);
      setCurrent(""); setNext(""); setNext2("");
    });
  };

  if (done) {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p>Пароль изменён. На вашу почту отправлено уведомление.</p>
        <p className="text-muted-foreground">
          Все другие сессии закрыты — на остальных устройствах нужно войти заново.
        </p>
        <button
          type="button"
          className="w-fit text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => setDone(false)}
        >
          Сменить ещё раз
        </button>
      </div>
    );
  }

  return (
    <form name="password_change" onSubmit={submit} className="flex max-w-sm flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Текущий пароль
        <PasswordInput required autoComplete="current-password" className={INPUT}
          value={current} onChange={(e) => setCurrent(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Новый пароль
        <PasswordInput required minLength={8} autoComplete="new-password" className={INPUT}
          placeholder="Не короче 8 символов"
          value={next} onChange={(e) => setNext(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Повторите новый пароль
        <PasswordInput required minLength={8} autoComplete="new-password" className={INPUT}
          placeholder="Тот же пароль ещё раз"
          value={next2} onChange={(e) => setNext2(e.target.value)} />
      </label>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" pending={pending} className="w-fit">Сменить пароль</Button>
      <p className="text-xs text-muted-foreground">
        После смены все другие сессии будут закрыты.
      </p>
    </form>
  );
}
