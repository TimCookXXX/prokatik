"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { Button } from "@/components/ui/button";
import { field } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { submitNewPassword } from "@/server/actions/auth-email";

const INPUT = `${field} h-11 w-full px-5`;

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== password2) { setError("Пароли не совпадают"); return; }

    startTransition(async () => {
      const res = await submitNewPassword({ token, password });
      if (res.ok) { router.push(res.data.redirectTo as Route); router.refresh(); return; }
      setError(res.error);
    });
  };

  return (
    <form name="password_reset" onSubmit={submit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Новый пароль
        <PasswordInput required minLength={8} autoComplete="new-password" className={INPUT}
          placeholder="Не короче 8 символов"
          value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Повторите пароль
        <PasswordInput required minLength={8} autoComplete="new-password" className={INPUT}
          placeholder="Тот же пароль ещё раз"
          value={password2} onChange={(e) => setPassword2(e.target.value)} />
      </label>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" pending={pending}>Сохранить пароль</Button>
      <p className="text-xs text-muted-foreground">
        После смены пароля все другие сессии будут закрыты.
      </p>
    </form>
  );
}
