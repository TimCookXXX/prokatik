"use client";

// Значение с кнопкой «Скопировать» — ClientID Метрики для поиска записи
// Вебвизора. Само значение остаётся выделяемым текстом: если буфер обмена
// недоступен (http, отказ браузера), его копируют руками.

import { useState } from "react";
import { content } from "@theme/content";
import { Button } from "@/components/ui/button";

const t = content.adminAnalytics.visitor;

export function CopyValue({ value }: { value: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <code className="select-all break-all font-mono text-sm">{value}</code>
      <Button type="button" variant="outline" size="sm" onClick={copy}>
        {state === "copied" ? t.copied : t.copy}
      </Button>
      {state === "failed" && <span role="status" className="text-xs text-muted-foreground">{t.copyFailed}</span>}
    </span>
  );
}
