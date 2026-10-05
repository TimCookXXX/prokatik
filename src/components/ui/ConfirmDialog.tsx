"use client";

import { useState, useId } from "react";
import { Modal, ModalClose, ModalContent, ModalDescription, ModalTitle, ModalTrigger } from "@/components/ui/Modal";
import { Button } from "@/components/ui/button";
import { field } from "@/components/ui/field";
import { WEBVISOR_PRIVATE } from "@/components/analytics/webvisor";

type Props = {
  trigger: React.ReactNode;
  title: string;
  description: string;
  typedConfirm?: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
};

export function ConfirmDialog({
  trigger, title, description, typedConfirm, confirmLabel, destructive, onConfirm,
}: Props) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  const canConfirm = typedConfirm ? input === typedConfirm : true;

  // Неудача оставляет окно открытым и показывает причину. Раньше окно
  // закрывалось всегда, и отказ сервера выглядел как «ничего не произошло» —
  // особенно там, где рядом с кнопкой нет ни строчки текста.
  const handle = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      setOpen(false);
      setInput("");
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Не удалось выполнить действие.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setInput(""); setError(null); } }}>
      <ModalTrigger asChild>{trigger}</ModalTrigger>
      {/* Подтверждения живут в кабинете и называют заявки и людей; портал
        * выносит окно из обёртки личной зоны. */}
      <ModalContent className={`md:w-[min(90vw,420px)] ${WEBVISOR_PRIVATE}`}>
          <ModalTitle className="font-display text-lg mb-2">{title}</ModalTitle>
          <ModalDescription className="text-sm text-muted-foreground mb-4">
            {description}
          </ModalDescription>
          {typedConfirm && (
            <div className="mb-4">
              <label htmlFor={inputId} className="block text-xs text-muted-foreground mb-1">
                Введи <code>{typedConfirm}</code> для подтверждения
              </label>
              <input
                id={inputId}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className={`${field} w-full px-3 py-2 text-sm`}
              />
            </div>
          )}
          {error && (
            <p className="mb-3 text-sm text-destructive" role="alert">{error}</p>
          )}
          <div className="flex justify-end gap-2">
            <ModalClose asChild>
              <Button variant="outline" type="button">Отмена</Button>
            </ModalClose>
            <Button
              type="button"
              variant={destructive ? "destructive" : "default"}
              disabled={!canConfirm}
              pending={busy}
              onClick={handle}
            >
              {confirmLabel}
            </Button>
          </div>
      </ModalContent>
    </Modal>
  );
}
