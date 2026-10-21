"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { field } from "@/components/ui/field";
import { adminCreateCategory } from "@/server/actions/admin";

const INPUT = `${field} h-10 px-3 text-sm`;

export function CategoryForm({ roots }: { roots: Array<{ id: string; name: string }> }) {
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [vertical, setVertical] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await adminCreateCategory({ name, parentId, vertical });
      if (!r.ok) setError(r.error);
      else { setName(""); setVertical(""); }
    });
  };

  return (
    <form name="admin_category" onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Название
        <input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} className={INPUT} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Родитель
        <select value={parentId} onChange={(e) => setParentId(e.target.value)} className={INPUT}>
          <option value="">— корневая —</option>
          {roots.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Vertical
        <input value={vertical} placeholder="tools / sport / ..." onChange={(e) => setVertical(e.target.value)} className={INPUT} />
      </label>
      <Button type="submit" size="sm" pending={pending}>Добавить</Button>
      {error && <p className="w-full text-sm text-destructive">{error}</p>}
    </form>
  );
}
