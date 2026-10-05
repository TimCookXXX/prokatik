"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Trash2, Upload } from "lucide-react";
import { Brackets } from "@/components/brand/Brackets";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/Avatar";
import { Modal, ModalContent, ModalTitle, ModalTrigger } from "@/components/ui/Modal";
import { AvatarCropper, decodeImage, type DecodedImage } from "@/components/account/AvatarCropper";
import { updateAvatar } from "@/server/actions/profile";
import { cn } from "@/lib/utils";
import { WEBVISOR_PRIVATE } from "@/components/analytics/webvisor";

/* Смена аватарки. Живёт в двух местах: кнопка-камера на самой аватарке в шапке
 * кабинета открывает Modal (на мобиле — лист снизу), а на экране настроек тот
 * же выбор лежит прямо на странице. Ровно как сделана обложка. */

// Тот же предел, что и у ручки загрузки. Проверяем до декодирования: смысла
// разворачивать в память стомегабайтный файл, чтобы получить 413, нет.
const MAX_BYTES = 10 * 1024 * 1024;

export function AvatarChoice({
  image,
  name,
  onDone,
  onBusyChange,
}: {
  image: string | null;
  name: string | null;
  /** Вызывается после успешного сохранения — пикер закрывает окно. */
  onDone?: () => void;
  /** Наверх, чтобы окно не закрывалось посреди загрузки. Обязан быть
    * стабильным: он в зависимостях эффекта. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<DecodedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, startSaving] = useTransition();
  const busy = uploading || saving;

  /* ImageBitmap держит несжатые пиксели — освобождаем, как только кадр не
   * нужен. Именно здесь, а не в сеттерах: обновляющая функция useState в
   * StrictMode вызывается дважды, и освобождать картинку внутри неё нельзя. */
  useEffect(() => () => picked?.release(), [picked]);

  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);

  const pickFile = async (files: FileList | null) => {
    const file = files?.[0];
    // Один и тот же файл должен выбираться повторно — например, после ошибки.
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    setError(null);
    if (file.size > MAX_BYTES) {
      setError("Файл больше 10 МБ. Выберите фотографию полегче.");
      return;
    }
    try {
      setPicked(await decodeImage(file));
    } catch {
      setError("Не удалось прочитать файл. Подойдёт JPEG, PNG или WebP.");
    }
  };

  const commit = (url: string | null) => {
    startSaving(async () => {
      const res = await updateAvatar(url);
      if (!res.ok) {
        setError("Не удалось сохранить аватарку.");
        return;
      }
      setPicked(null);
      router.refresh();
      onDone?.();
    });
  };

  const save = (blob: Blob) => {
    setError(null);
    setUploading(true);
    void (async () => {
      try {
        const fd = new FormData();
        fd.append("image", blob, "avatar");
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body?.file?.url) {
          setError(res.status === 503
            ? "Хранилище изображений не настроено (STORAGE_* в .env)."
            : "Не удалось загрузить фотографию.");
          return;
        }
        commit(body.file.url as string);
      } finally {
        setUploading(false);
      }
    })();
  };

  if (picked) {
    return (
      <div className="flex flex-col gap-4">
        <AvatarCropper
          image={picked}
          busy={busy}
          onCancel={() => setPicked(null)}
          onDone={save}
        />
        {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <Avatar src={image} name={name} size={96} />
        <div className="flex min-w-0 flex-col gap-2">
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
            <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
            {image ? "Заменить фото" : "Загрузить фото"}
          </Button>
          {image && (
            <Button variant="ghost" onClick={() => commit(null)} disabled={busy} className="text-muted-foreground">
              {saving
                ? <Brackets size={12} running className="mr-2 text-current" />
                : <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />}
              {saving ? "Убираем…" : "Убрать"}
            </Button>
          )}
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        /* Тот же список, что у обложки: HEIC с айфона ручка не примет. */
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => void pickFile(e.target.files)}
      />

      <p className="text-xs text-muted-foreground">
        {image
          ? "Аватарку видно всем: в объявлениях, переписке и на вашей публичной странице. Если её убрать, останется кружок с первой буквой имени. Прежнюю картинку сервис не хранит: свою вы сможете загрузить заново, а ту, что подставил вход через Яндекс или VK, — уже нет."
          : "Аватарку видно всем: в объявлениях, переписке и на вашей публичной странице. Кадр выберете сами на следующем шаге."}
      </p>
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
    </div>
  );
}

/** Кнопка на самой аватарке: открывает выбор в окне (мобайл — лист снизу). */
export function AvatarPickerButton({
  image,
  name,
  className,
}: {
  image: string | null;
  name: string | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  /* Пока идёт загрузка, окно закрывать нельзя. Не ради красоты: fetch и
   * транзишен переживут размонтирование, и если ответ окажется ошибкой (скажем,
   * 503 без STORAGE_*), показать её будет уже некому — со стороны это выглядит
   * как «нажал и ничего не произошло». */
  const [busy, setBusy] = useState(false);

  return (
    <Modal open={open} onOpenChange={(next) => { if (!next && busy) return; setOpen(next); }}>
      <ModalTrigger
        aria-label="Сменить аватарку"
        title="Сменить аватарку"
        className={cn(
          // Кружок 32px, но нажимается как 44px: псевдоэлемент расширяет зону,
          // не раздвигая вёрстку — в мобильной шапке аватарка вплотную к имени.
          "relative flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-sm transition-colors hover:text-accent",
          "before:absolute before:-inset-1.5 before:content-['']",
          "focus-visible:[outline:none] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          className,
        )}
      >
        <Camera className="h-4 w-4" aria-hidden="true" />
      </ModalTrigger>
      <ModalContent
        aria-describedby={undefined}
        className={cn("md:max-w-md", WEBVISOR_PRIVATE)}
        showClose={!busy}
        // Пока идёт загрузка, лист нельзя утянуть жестом: отказ в onOpenChange
        // оставил бы его повисшим на полпути — vaul не возвращает лист на
        // место, когда закрытие отвергли. Атрибут понимает только vaul,
        // десктопной шкуре он безвреден.
        {...(busy ? { "data-vaul-no-drag": "" } : {})}
        onEscapeKeyDown={(e) => { if (busy) e.preventDefault(); }}
        onPointerDownOutside={(e) => { if (busy) e.preventDefault(); }}
        onInteractOutside={(e) => { if (busy) e.preventDefault(); }}
      >
        <ModalTitle className="mb-4 font-display text-lg font-bold">Аватарка</ModalTitle>
        {/* Условный рендер: при каждом открытии выбор начинается заново, и
          * кроппер не монтируется, пока окно закрыто. */}
        {open && (
          <AvatarChoice
            image={image}
            name={name}
            onDone={() => setOpen(false)}
            onBusyChange={setBusy}
          />
        )}
      </ModalContent>
    </Modal>
  );
}
