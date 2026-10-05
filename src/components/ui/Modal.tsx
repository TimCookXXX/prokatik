"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Drawer } from "vaul";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsDesktop } from "@/components/ui/use-desktop";

/* Единственный примитив всплывающих ОКОН в проекте: вход, заявка на бронь,
 * подтверждения, фильтры каталога. Modal — прерывание: вопрос, форма,
 * подтверждение; подробности строки списка — это Sheet, граница записана там.
 *
 * Поведение: на мобиле лист снизу, и лист НАСТОЯЩИЙ — vaul, тянется пальцем и
 * закрывается рывком; прежде ручка была нарисована, а жеста за ней не было.
 * На десктопе — центрированное окно Radix, как раньше, до пикселя.
 *
 * Устройство: два корня, переключаемые шириной. vaul построен поверх Radix
 * Dialog и реэкспортирует его примитивы, поэтому Trigger/Title/Close — одни и
 * те же компоненты под обоими корнями; импортируем их из Radix напрямую.
 * Ширина меряется в JS — это законно, потому что Modal НЕ ОТКРЫВАЕТСЯ в первом
 * рендере: все семь потребителей открывают его жестом. Инвариант держать.
 *
 * Режим замораживается, пока окно открыто: ресайз под открытым окном не
 * пересобирает его — dialog, меняющий форму под руками, хуже листа, дожившего
 * до закрытия. Контент узнаёт режим из контекста, а не меряет сам: два
 * независимых замера могли бы разъехаться, и Drawer.Content под чужим корнем
 * не падает, а тихо ломается — vaul создаёт контекст с непустым дефолтом. */

type Mode = "desktop" | "mobile";
const ModeContext = React.createContext<Mode>("mobile");

export const ModalTrigger = Dialog.Trigger;
export const ModalClose = Dialog.Close;
export const ModalTitle = Dialog.Title;
export const ModalDescription = Dialog.Description;

type RootProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
};

export function Modal({ open, defaultOpen, onOpenChange, children }: RootProps) {
  const desktop = useIsDesktop();

  // Зеркало открытости нужно и неконтролируемым окнам (фильтры каталога):
  // заморозка режима обязана знать, открыто ли окно, а ref без ре-рендера
  // оставил бы корень в чужом режиме после закрытия.
  const [openMirror, setOpenMirror] = React.useState(defaultOpen ?? false);
  const isOpen = open ?? openMirror;

  const target: Mode = desktop ? "desktop" : "mobile";
  const [mode, setMode] = React.useState<Mode>(target);
  // Подстройка состояния прямо в рендере — санкционированный React приём:
  // закрытое окно следует за шириной, открытое держит режим.
  if (!isOpen && mode !== target) setMode(target);

  const handleOpenChange = (next: boolean) => {
    setOpenMirror(next);
    onOpenChange?.(next);
  };

  const rootProps = { open, defaultOpen, onOpenChange: handleOpenChange };

  return (
    <ModeContext.Provider value={mode}>
      {mode === "desktop" ? (
        <Dialog.Root {...rootProps}>{children}</Dialog.Root>
      ) : (
        /* noBodyStyles: body-lock через position:fixed у vaul — модульный
         * синглтон, и вложенный конфирм, закрываясь, снимал бы его у ещё
         * открытой шторки заявок (iOS). Скролл держат refcounted-механизмы
         * Radix и vaul, им вложенность не страшна. */
        <Drawer.Root direction="bottom" noBodyStyles {...rootProps}>
          {children}
        </Drawer.Root>
      )}
    </ModeContext.Provider>
  );
}

type ContentProps = React.ComponentPropsWithoutRef<typeof Dialog.Content> & {
  /** Крестик в углу. Убирается там, где закрывать окно должен только выбор. */
  showClose?: boolean;
};

export const ModalContent = React.forwardRef<HTMLDivElement, ContentProps>(
  ({ className, children, showClose = true, onOpenAutoFocus, ...props }, ref) => {
    const mode = React.useContext(ModeContext);
    const contentRef = React.useRef<HTMLDivElement>(null);
    const setRefs = React.useCallback((node: HTMLDivElement | null) => {
      contentRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
    }, [ref]);

    // Radix по умолчанию фокусирует первый интерактивный элемент — на iOS это
    // мгновенно поднимает клавиатуру поверх листа. Фокус уводим на само окно:
    // ловушка фокуса и объявление скринридером продолжают работать.
    const autoFocus = (e: Event) => {
      onOpenAutoFocus?.(e);
      if (e.defaultPrevented) return;
      e.preventDefault();
      contentRef.current?.focus();
    };

    const closeButton = showClose && (
      <Dialog.Close
        aria-label="Закрыть"
        className="tap-target absolute right-3 top-3 z-10 rounded-sm p-1.5 text-muted-foreground transition-colors hoverable hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </Dialog.Close>
    );

    if (mode === "desktop") {
      return (
        <Dialog.Portal>
          <Dialog.Overlay
            className={cn(
              "fixed inset-0 z-50 bg-black/50",
              "data-[state=open]:animate-in data-[state=closed]:animate-out",
              "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
            )}
          />
          <Dialog.Content
            ref={setRefs}
            tabIndex={-1}
            onOpenAutoFocus={autoFocus}
            className={cn(
              // Прежняя десктопная шкура, только без md:-префиксов: этот код
              // рендерится ТОЛЬКО в десктопном режиме, а под открытым окном
              // ресайз режим не меняет — префиксам не от чего защищать.
              // Центрирование через inset-0 + margin:auto, не translate: плагин
              // анимаций подменяет transform, и окно прилетало бы из угла.
              // [outline:none], не outline-none: утилита даёт прозрачную
              // обводку, и та проступает по краю во время анимации.
              "fixed inset-0 z-50 m-auto h-fit max-h-[85vh] w-[calc(100vw-2rem)]",
              "overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-lg",
              "duration-200 focus:[outline:none]",
              "data-[state=open]:animate-in data-[state=closed]:animate-out",
              "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
              "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
              className,
            )}
            {...props}
          >
            {children}
            {closeButton}
          </Dialog.Content>
        </Dialog.Portal>
      );
    }

    return (
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Drawer.Content
          ref={setRefs}
          tabIndex={-1}
          onOpenAutoFocus={autoFocus}
          // Своя строка классов, не общая база с десктопной: анимации здесь
          // рисует vaul своим инжектированным CSS, и animate-in с ним спорил бы.
          // Боковые отступы — под чёлку телефона на боку.
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col",
            "pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]",
            "rounded-t-lg border-t border-border bg-card focus:[outline:none]",
            className,
          )}
          {...props}
        >
          {/* Ручка обещает жест — теперь он есть. Вне скролл-контейнера: за
            * неё тянут, она не уезжает с содержимым. */}
          <div aria-hidden="true" className="flex-none cursor-grab py-3">
            <div className="mx-auto h-1 w-10 rounded-pill bg-border" />
          </div>
          {/* Скролл — внутренним контейнером обязательно: vaul вешает
            * touch-action:none на сам контент, и палец не смог бы прокрутить
            * длинную форму фильтров, будь скроллером контент. */}
          <div className="flex-1 overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            {children}
          </div>
          {closeButton}
        </Drawer.Content>
      </Drawer.Portal>
    );
  });
ModalContent.displayName = "ModalContent";
