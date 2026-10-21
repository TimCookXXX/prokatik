"use client";

// Лента переписки и композер.
//
// Состояние живёт здесь, а не на сервере с router.refresh(): в задаче «доставка
// по вебсокетам» сюда придёт сокет и будет доливать сообщения в тот же массив.
// Поэтому любое пополнение ленты идёт через upsert() и идемпотентно по id.
// Сборка ленты (группы, разделители) — чистая функция buildFeed, независимая от
// порядка прихода: сокет не обязан присылать сообщения по возрастанию.

import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCheck, ChevronDown, Clock, SendHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MAX_MESSAGE_LENGTH } from "@/lib/chat/validation";
import { field } from "@/components/ui/field";
import { chatErrorText } from "@/lib/chat/errors";
import { useRealtime } from "@/components/realtime/context";
import { useSyncCounters } from "@/components/realtime/useSyncCounters";
import { fetchNewerMessages } from "@/server/actions/realtime";
import { buildFeed, unreadAnchor } from "@/lib/chat/grouping";
import { fetchOlderMessages, postMessage, startThread, markThreadRead } from "@/server/actions/chat";
import { DateDivider, SystemNote, UnreadDivider } from "@/components/chat/FeedDividers";
import { isUnreadFor } from "@/lib/chat/unread";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { content } from "@theme/content";
import type { ThreadMessage } from "@/server/chat";
import { reachGoal } from "@/components/analytics/goals";

const t = content.chat;

export type ComposerMode =
  | { kind: "thread"; threadId: string }
  | { kind: "new"; listingId: string };

/** Сообщение в полёте: ключ свой, потому что одинаковый текст можно отправить
 *  дважды подряд, и по тексту такие пузыри неразличимы. */
type Pending = { key: number; body: string };

// Потолок цикла догона: страница по 40 сообщений, то есть до 400 за раз.
// Дальше проще перезагрузить тред, чем тянуть историю по сокету.
const CATCH_UP_PAGES = 10;

export function ThreadView({
  mode, viewerId, initialMessages, initialHasMore, blockedReason,
  viewerCursor = null, counterpartCursor = null, counterpartName = null, typing = false,
}: {
  mode: ComposerMode;
  viewerId: string;
  initialMessages: ThreadMessage[];
  initialHasMore: boolean;
  /** Текст вместо композера, когда писать нельзя (объявление снято, бан). */
  blockedReason?: string;
  /** Мой курсор прочтения на момент открытия — по нему ставится разделитель. */
  viewerCursor?: string | null;
  /** Курсор собеседника на момент открытия — по нему рисуются галочки. Дальше
   *  живёт в состоянии и двигается событием сокета: сигнал о сдвиге появился
   *  вместе с доставкой в реальном времени. */
  counterpartCursor?: string | null;
  counterpartName?: string | null;
  /** Заготовка под задачу 2: включить индикатор до сокета нечем. */
  typing?: boolean;
}) {
  const router = useRouter();
  const syncCounters = useSyncCounters();
  const [messages, setMessages] = useState(initialMessages);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSending, startTransition] = useTransition();
  const feedRef = useRef<HTMLOListElement>(null);
  const nextKey = useRef(0);
  // Отдельный живой регион ВНЕ ленты. Атрибут на самой <ol> объявлял бы и
  // догрузку сорока ранних сообщений тоже — скринридер зачитал бы их все.
  // Пара «текст + счётчик»: два одинаковых сообщения подряд не меняют строку,
  // DOM остаётся прежним, и живой регион молчит. Счётчик делает каждое
  // объявление новым, не попадая при этом в озвучку.
  const [announcement, setAnnouncement] = useState<{ text: string; n: number }>(
    { text: "", n: 0 },
  );
  // Лента прячется, пока не встала на место. Прокруткой это не чинится: сервер
  // отдаёт готовый HTML, браузер рисует его СРАЗУ и всегда сверху, а сдвинуть
  // ленту можно только после гидратации — примерно через сотню миллисекунд.
  // Всё это время человек смотрел на верх переписки, а потом видел рывок вниз.
  //
  // Пустая лента на те же сто миллисекунд читается спокойнее, чем содержимое,
  // которое прыгает. Начальное значение одинаково на сервере и на клиенте,
  // поэтому гидратацию это не ломает.
  const [positioned, setPositioned] = useState(false);
  // Сколько ЧУЖИХ сообщений пришло, пока человек читал старое. Своих здесь быть
  // не может: отправка всегда возвращает ленту вниз.
  const [unseenBelow, setUnseenBelow] = useState(0);

  const threadId = mode.kind === "thread" ? mode.threadId : null;

  // Событие сокета тела сообщения не несёт — его надо дочитать; отметку
  // прочтения оно несёт целиком.
  const liveMessage = useRealtime((s) => s.lastMessage);
  const resyncAt = useRealtime((s) => s.resyncAt);
  const liveRead = useRealtime((s) => s.lastRead);


  // Якорь непрочитанного снимается один раз, до markThreadRead: иначе
  // разделитель исчезнет через мгновение после открытия переписки.
  const [anchorId] = useState(() => unreadAnchor(initialMessages, viewerCursor, viewerId));

  // Курсор собеседника: сеется пропом, дальше двигается событием. Только
  // вперёд — событие из другой вкладки или доехавшее с опозданием не должно
  // возвращать галочки назад. ULID сравнивается лексикографически.
  const [readCursor, setReadCursor] = useState(counterpartCursor);

  // Двигать курсор вперёд — общее правило для обоих источников: событие может
  // прийти дважды, а проп после router.refresh — оказаться свежее пропущенного
  // события. Назад не откатываем никогда: снятая галочка выглядит как ошибка.
  const advanceRead = useCallback((upToId: string | null) => {
    if (!upToId) return;
    setReadCursor((prev) => (!prev || upToId > prev ? upToId : prev));
  }, []);

  useEffect(() => {
    if (!threadId || !liveRead || liveRead.threadId !== threadId) return;
    advanceRead(liveRead.upToId);
  }, [threadId, liveRead, advanceRead]);

  // Проп обновляется серверной перерисовкой. Без этого состояние, засеянное
  // один раз, навсегда отставало бы от базы — стоило пропустить одно событие.
  useEffect(() => { advanceRead(counterpartCursor); }, [counterpartCursor, advanceRead]);

  const feed = useMemo(
    () => buildFeed(messages, { viewerId, unreadAnchorId: anchorId }),
    [messages, viewerId, anchorId],
  );

  const upsert = useCallback((incoming: ThreadMessage[]) => {
    setMessages((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]));
      for (const m of incoming) byId.set(m.id, m);
      return [...byId.values()];
    });
  }, []);

  // Объявляется только ЧУЖОЕ сообщение и только при видимой вкладке: своё
  // человек и так только что отправил, а фоновой вкладке зачитывать нечего.
  const announce = useCallback((incoming: ThreadMessage[]) => {
    if (document.visibilityState !== "visible") return;
    const foreign = incoming.filter((m) => isUnreadFor(m, viewerId, null));
    const last = foreign[foreign.length - 1];
    if (!last) return;
    setAnnouncement((prev) => ({
      text: `${counterpartName ?? "Собеседник"}: ${last.body}`,
      n: prev.n + 1,
    }));
  }, [viewerId, counterpartName]);

  // Лента — свой скроллер: панель ограничена по высоте на обеих ширинах, и
  // двигать надо её scrollTop, а не страницу, иначе уедет вся панель. Запасная
  // ветка на случай, когда высота ленты всё-таки по контенту (короткая
  // переписка): тогда доводим до якоря в конце.
  // Пока идёт наша собственная плавная прокрутка, события scroll сыплются
  // каждый кадр. Без этого флага замер «внизу ли человек» ловил бы промежуточные
  // положения анимации и отменял прилипание на полпути.
  const firstRun = useRef(true);
  const autoScrolling = useRef(false);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Только собственный scrollTop. scrollIntoView здесь был ошибкой: он двигает
  // ВСЕ скроллеры-предки, включая страницу, и на мобиле это выглядело рывком
  // всего экрана. Когда лента короче контейнера, scrollTop и так остаётся 0 —
  // прокручивать нечего, распорка прижимает сообщения к низу сама.
  //
  // smooth только там, где человек сам вызвал движение: отправил сообщение,
  // нажал «новые». Постановка на место при открытии обязана быть мгновенной —
  // анимация там вернула бы ровно тот рывок, ради которого лента и прячется до
  // позиционирования.
  const scrollToEnd = useCallback((smooth = false) => {
    const feedEl = feedRef.current;
    if (!feedEl) return;

    // Уважаем системную настройку: кому анимации мешают, тому и эта не нужна.
    const reduced = typeof window !== "undefined"
      && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    // typeof: Element.scrollTo есть не везде (в jsdom его нет вовсе), и падать
    // из-за отсутствия анимации нельзя — прокрутка важнее плавности.
    if (!smooth || reduced || typeof feedEl.scrollTo !== "function") {
      feedEl.scrollTop = feedEl.scrollHeight;
      return;
    }
    autoScrolling.current = true;
    if (autoTimer.current) clearTimeout(autoTimer.current);
    // Запас поверх типичной длительности плавной прокрутки: события scrollend
    // есть не везде, а держать флаг вечно нельзя.
    autoTimer.current = setTimeout(() => { autoScrolling.current = false; }, 700);
    feedEl.scrollTo({ top: feedEl.scrollHeight, behavior: "smooth" });
  }, []);

  useEffect(() => () => {
    if (autoTimer.current) clearTimeout(autoTimer.current);
  }, []);

  // Насколько далеко от низа человек ещё считается «внизу». Пара строк запаса:
  // иначе инерционная прокрутка на мобиле оставляет пару пикселей и лента
  // перестаёт доезжать сама.
  const NEAR_BOTTOM_PX = 120;
  const stickToBottom = useRef(true);

  // Отслеживается прокруткой, а не замером в эффекте. Любой эффект — включая
  // layout — выполняется УЖЕ ПОСЛЕ обновления DOM: новое сообщение к этому
  // моменту ленту удлинило, и замер решал бы, что человек далеко от низа.
  // Прилипание выключалось само, как только лента переполнялась.
  //
  // onScroll ловит намерение человека, а не последствие нашей же вставки.
  // (Ниже useLayoutEffect используется по прямому назначению — прокрутить до
  // отрисовки, — и с этим замером не конфликтует.)
  // Последнее сообщение, которое человек видел, стоя внизу. По нему считается,
  // сколько пришло за время чтения старого.
  const seenUpTo = useRef("");

  const onFeedScroll = useCallback(() => {
    const feedEl = feedRef.current;
    if (!feedEl) return;
    // Кадры собственной анимации за намерение человека не считаем.
    if (autoScrolling.current) return;
    const distance = feedEl.scrollHeight - feedEl.scrollTop - feedEl.clientHeight;
    stickToBottom.current = distance <= NEAR_BOTTOM_PX;
    // Доехал до низа сам — значит всё увидел, кнопка больше не нужна.
    if (stickToBottom.current) setUnseenBelow(0);
  }, []);

  // useLayoutEffect, а не useEffect: он выполняется до отрисовки, и человек не
  // видит, как лента прыгает. С обычным эффектом при перезагрузке посреди
  // переписки заметен рывок — сначала показывается верх, потом низ.
  useLayoutEffect(() => {
    // Догрузку ранней истории пропускаем: она дописывает СВЕРХУ, и прыжок вниз
    // выбросил бы человека из того, что он читает.
    if (loadingOlder) return;
    const newest = messages.reduce((acc, m) => (m.id > acc ? m.id : acc), "");
    // Липнем к низу, только если человек и так там. Читает старое — не дёргаем,
    // но считаем, сколько чужих сообщений пришло: об этом скажет кнопка.
    if (!stickToBottom.current) {
      setUnseenBelow(
        messages.filter((m) => isUnreadFor(m, viewerId, seenUpTo.current)).length,
      );
      return;
    }
    seenUpTo.current = newest;
    setUnseenBelow(0);
    // Первый прогон — открытие переписки: там прокрутка обязана быть мгновенной,
    // иначе анимация поедет поверх постановки на место и человек увидит, как
    // лента ползёт снизу вверх. Плавно — только то, что он сам вызвал дальше.
    scrollToEnd(!firstRun.current);
    firstRun.current = false;
    // Зависимость от длины, а не от массива: upsert возвращает новый массив
    // даже когда ничего не изменилось, и лента прокручивалась бы вхолостую.
  }, [scrollToEnd, messages, pending.length, loadingOlder, viewerId]);

  // При смене переписки внизу оказываемся всегда, чем бы ни кончилась прошлая.
  useLayoutEffect(() => {
    stickToBottom.current = true;
    setUnseenBelow(0);
    scrollToEnd();
    setPositioned(true);
    // Флаг снимается ЗДЕСЬ, а не в эффекте сообщений. Эффекты выполняются в
    // порядке объявления, и этот идёт последним: к моменту его завершения лента
    // уже поставлена на место, а всё дальнейшее вызвано человеком и должно быть
    // плавным. Выставление флага здесь в true возвращало его после того, как
    // эффект сообщений уже сбросил, — и первая отправка ехала рывком.
    firstRun.current = false;
  }, [threadId, scrollToEnd]);

  const jumpToNew = useCallback(() => {
    stickToBottom.current = true;
    setUnseenBelow(0);
    scrollToEnd(true);
  }, [scrollToEnd]);

  useEffect(() => {
    if (!threadId) return;
    let cancelled = false;
    void markThreadRead(threadId).then((res) => {
      if (cancelled || !res.ok) return;
      router.refresh();
      // refresh обновляет серверный проп, а бейдж и кружок при живом сокете
      // читают стор — без этого прочитанное гасло бы только в базе.
      syncCounters();
    });
    return () => { cancelled = true; };
  }, [threadId, router, syncCounters]);

  // Курсор догона берётся по максимальному id, а не по хвосту массива:
  // «показать более ранние» дописывает в него СТАРЫЕ сообщения.
  const catchingUp = useRef(false);

  useEffect(() => {
    if (!threadId) return;
    // Догон нужен только этому треду. Событие по чужому обновит список слева —
    // этим занимается дебаунсенный refresh в провайдере.
    if (liveMessage && liveMessage.threadId !== threadId) return;
    if (!liveMessage && resyncAt === null) return;
    // Эхо собственного сообщения уже лежит в состоянии: без этой проверки
    // каждая отправка стоила бы лишнего раунда к серверу.
    if (liveMessage && messages.some((m) => m.id === liveMessage.messageId)) return;
    // Пачка событий коалесцируется в один догон, и он не стартует поверх
    // идущего loadOlder — иначе два ответа перетасуют ленту.
    if (catchingUp.current || loadingOlder) return;

    catchingUp.current = true;
    let cancelled = false;
    void (async () => {
      try {
        // Циклом до конца: при длинном разрыве накопленного может быть больше
        // страницы, и остановка на первой оставила бы дыру в середине ленты.
        let cursor = messages.reduce((acc, m) => (m.id > acc ? m.id : acc), "");
        for (let page = 0; page < CATCH_UP_PAGES; page += 1) {
          const res = await fetchNewerMessages(threadId, cursor);
          if (cancelled || !res.ok || res.data.messages.length === 0) break;
          upsert(res.data.messages);
          announce(res.data.messages);
          cursor = res.data.messages[res.data.messages.length - 1].id;
          if (!res.data.hasMore) break;
        }
        // Приехавшее в открытую и ВИДИМУЮ ленту прочитано: иначе курсор
        // застрянет на моменте открытия, счётчики вырастут, а при следующем
        // заходе разделитель «непрочитанные» встанет над уже прочитанным.
        // Фоновая вкладка гасить непрочитанное не должна.
        if (!cancelled && document.visibilityState === "visible") {
          void markThreadRead(threadId).then(() => syncCounters());
        }
      } finally {
        // finally, а не хвост try: сеть отвалилась ровно тогда, когда догон и
        // нужен, и без сброса флаг залипал бы навсегда.
        catchingUp.current = false;
      }
    })();
    // Флаг в cleanup НЕ сбрасывается: React зовёт cleanup перед каждым
    // повторным прогоном, и сброс там обнулял бы охранник на каждом событии —
    // то есть охранника бы не было вовсе.
    return () => { cancelled = true; };
    // messages в зависимостях нет намеренно: догон реагирует на событие, а не на
    // собственный результат — иначе он зациклится сам на себе.
  }, [threadId, liveMessage, resyncAt, loadingOlder, upsert, announce, syncCounters]);

  async function loadOlder() {
    if (!threadId || loadingOlder || messages.length === 0) return;
    const oldest = [...messages].sort((a, b) => (a.id < b.id ? -1 : 1))[0];
    setLoadingOlder(true);
    const res = await fetchOlderMessages(threadId, oldest.id);
    setLoadingOlder(false);
    if (!res.ok) { setError(chatErrorText(res.error)); return; }
    upsert(res.data.messages);
    setHasMore(res.data.hasMore);
  }

  function send() {
    const body = draft.trim();
    if (!body || isSending) return;
    const key = nextKey.current++;
    setDraft("");
    setError(null);
    // СВОЁ сообщение всегда возвращает ленту вниз, где бы человек ни читал.
    // Правило «не дёргать того, кто смотрит старое» относится только к ЧУЖИМ
    // сообщениям: своё он сам только что написал и хочет его увидеть.
    stickToBottom.current = true;
    setPending((prev) => [...prev, { key, body }]);

    const fail = (code: string) => {
      setPending((prev) => prev.filter((p) => p.key !== key));
      setError(chatErrorText(code));
      setDraft((current) => current || body);
    };

    startTransition(async () => {
      // try обязателен: при обрыве сети вызов action'а не возвращает {ok:false},
      // а БРОСАЕТ. Без перехвата промис отклонялся молча, пузырь навсегда
      // оставался в состоянии «отправляется…», а текст пропадал вместе с ним.
      try {
        if (mode.kind === "new") {
          const res = await startThread({ listingId: mode.listingId, body });
          if (!res.ok) { fail(res.error); return; }
          // Тред уже был (его завела заявка из другой вкладки) — сообщение
          // дописано в него, и это не начало переписки.
          if (res.data.created) reachGoal("chat_started");
          upsert([res.data.message]);
          setPending([]);
          router.replace(`/chat/${res.data.threadId}` as never);
          return;
        }

        const res = await postMessage({ threadId: mode.threadId, body });
        if (!res.ok) { fail(res.error); return; }
        upsert([res.data.message]);
        setPending((prev) => prev.filter((p) => p.key !== key));
        router.refresh();
      } catch {
        fail("network");
      }
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Живой регион вне ленты и с aria-atomic: иначе скринридер зачитывал бы
        * всю историю при догрузке ранних сообщений. */}
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement.text}
        {/* Меняется вместе с текстом и не читается вслух: нужен только чтобы
          * повтор одного и того же сообщения тоже считался изменением. */}
        <span hidden>{announcement.n}</span>
      </p>
      {/* relative-обёртка: кнопка ложится поверх ленты, а не поверх композера,
        * и не участвует в её прокрутке. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
      <ol
        ref={feedRef}
        onScroll={onFeedScroll}
        tabIndex={0}
        aria-label="Сообщения"
        className={`flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3.5 py-4 [overscroll-behavior:contain] md:px-5 ${
          positioned ? "" : "invisible"
        }`}
      >
        {/* Распорка прижимает короткую переписку к низу ленты — как в любом
          * мессенджере: пара сообщений висит над полем ввода, а не под шапкой.
          * Именно распоркой, а не justify-end: при justify-end переполненная
          * лента вылезает за верхнюю кромку и доскроллить до начала нельзя.
          * flex-1 растёт только в свободное место, поэтому на длинной переписке
          * распорка схлопывается в ноль и ничего не занимает. */}
        <li aria-hidden="true" className="min-h-0 flex-1" />

        {hasMore && (
          <li className="mb-1 flex justify-center">
            <Button
              variant="outline"
              className="h-9"
              disabled={loadingOlder}
              onClick={() => void loadOlder()}
            >
              {loadingOlder ? t.loadingOlder : t.loadOlder}
            </Button>
          </li>
        )}

        {feed.length === 0 && pending.length === 0 && (
          <li className="py-8 text-center text-sm text-muted-foreground">{t.emptyMessages}</li>
        )}

        {feed.map((item) => {
          if (item.kind === "date") return <DateDivider key={item.key} label={item.label} />;
          if (item.kind === "unread") return <UnreadDivider key={item.key} count={item.count} />;
          if (item.kind === "system") return <SystemNote key={item.key} message={item.message} />;
          return (
            <Group
              key={item.key}
              mine={item.mine}
              messages={item.messages}
              counterpartCursor={readCursor}
            />
          );
        })}

        {pending.map((p) => (
          <li key={`pending-${p.key}`} className="flex justify-end">
            <Bubble mine last body={p.body} />
          </li>
        ))}

        {typing && <TypingIndicator name={counterpartName} />}
      </ol>

      {/* Чужое сообщение не утаскивает читающего вниз — иначе он терял бы место.
        * Но и молчать нельзя: без этой кнопки человек узнаёт о новом, только
        * докрутив до низа сам. */}
      {unseenBelow > 0 && (
        <button
          type="button"
          onClick={jumpToNew}
          className="hoverable absolute inset-x-0 bottom-3 mx-auto flex w-fit items-center gap-2 rounded-pill border border-border bg-card px-3.5 py-1.5 text-sm shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDown className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          {t.newBelow}
          <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-pill bg-accent px-1.5 text-2xs font-bold text-accent-foreground">
            {unseenBelow > 99 ? "99+" : unseenBelow}
          </span>
        </button>
      )}
      </div>

      {error && <p className="px-4 pb-1 text-sm text-destructive">{error}</p>}

      {blockedReason ? (
        <p className="m-3 rounded-lg bg-muted p-3 text-center text-sm text-muted-foreground">
          {blockedReason}
        </p>
      ) : (
        // На мобиле композер прилипает над таб-баром (панель там обычной высоты,
        // см. ChatPanes); на десктопе он просто нижняя полоса панели.
        /* pb с safe-area: на странице переписки --tabbar-h обнулена, а вместе с
         * ней ушёл и учёт домашней полосы айфона, который жил внутри неё. */
        /* Не sticky: панель ограничена по высоте и обрезает содержимое, поэтому
         * композер — просто нижний элемент колонки. Отступ снизу учитывает
         * домашнюю полосу айфона; при открытой клавиатуре её нет, и max() сам
         * отдаёт базовое значение. */
        <div className="shrink-0 border-t border-border bg-card px-3 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-4 md:pb-3">
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
              }}
              rows={1}
              maxLength={MAX_MESSAGE_LENGTH}
              placeholder={t.composerPlaceholder}
              aria-label={t.composerLabel}
              className={`${field} max-h-32 min-h-[44px] flex-1 resize-none px-3 py-2.5 text-sm md:min-h-[40px]`}
            />
            <Button
              onClick={send}
              disabled={!draft.trim() || isSending}
              className="h-11 w-11 shrink-0 rounded-lg p-0 md:h-10 md:w-10"
              aria-label={t.send}
            >
              <SendHorizontal className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Group({
  mine, messages, counterpartCursor,
}: {
  mine: boolean;
  messages: ThreadMessage[];
  counterpartCursor: string | null;
}) {
  return (
    <li className={`flex flex-col gap-0.5 ${mine ? "items-end" : "items-start"}`}>
      {messages.map((m, i) => (
        <Bubble
          key={m.id}
          mine={mine}
          last={i === messages.length - 1}
          body={m.body ?? ""}
          createdAt={m.createdAt}
          read={mine && Boolean(counterpartCursor && m.id <= counterpartCursor)}
        />
      ))}
    </li>
  );
}

function Bubble({
  mine, last, body, createdAt, read,
}: {
  mine: boolean;
  /** Время и статус печатаются только у последнего пузыря группы. */
  last: boolean;
  body: string;
  createdAt?: Date;
  read?: boolean;
}) {
  // Скошенный хвост у последнего в группе — рисунок формы, а не третий размер
  // шкалы радиусов: контракт токенов такое допускает.
  const tail = !last
    ? "rounded-lg"
    : mine
      ? "rounded-[12px_4px_12px_12px]"
      : "rounded-[12px_12px_12px_4px]";
  // Часы вместо слова «отправляется…»: слово заметно шире, чем «23:28 ✓», и
  // при замене на настоящее сообщение пузырь схлопывался — текст переливался
  // на глазах. Иконка держит ту же ширину, что и галочка, поэтому меняется
  // только она сама.
  const StatusIcon = createdAt ? (read ? CheckCheck : Check) : Clock;

  return (
    <div
      className={`max-w-[80%] px-3 py-2 md:max-w-[72%] ${tail} ${
        mine ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
      } ${createdAt ? "" : "opacity-60"}`}
    >
      <p className="whitespace-pre-wrap break-words text-base leading-body md:text-sm">{body}</p>
      {last && (
        <span
          suppressHydrationWarning
          className={`mt-0.5 flex items-center gap-1 text-2xs ${
            mine ? "justify-end opacity-70" : "text-muted-foreground"
          }`}
        >
          {/* У сообщения в полёте времени с сервера ещё нет, но место под него
            * занять надо — иначе ширина пузыря меняется дважды за секунду.
            * Локальное время отличается от серверного на доли секунды. */}
          {new Date(createdAt ?? Date.now())
            .toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
          {mine && (
            <>
              <StatusIcon className="h-3 w-3" aria-hidden="true" />
              <span className="sr-only">
                {!createdAt ? t.sending : read ? t.read : t.delivered}
              </span>
            </>
          )}
        </span>
      )}
    </div>
  );
}
