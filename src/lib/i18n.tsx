'use client';

// Локализация Mini App «Монтажная Кухня»: русский (RU) и украинский (UA).
// Мгновенное переключение без перезагрузки страницы; выбор хранится в localStorage.
// Словарь ua типизирован как Messages — TypeScript гарантирует полную симметрию ключей.

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';

export type Lang = 'ru' | 'ua';

export const LANGS: readonly Lang[] = ['ru', 'ua'];
export const LANG_STORAGE_KEY = 'mk_lang';
export const ONBOARDING_STORAGE_KEY = 'mk_onboarding_hidden';

const ru = {
  brand: 'Монтажная Кухня',
  header: {
    connecting: 'Подключаемся к кухне монтажа…',
    loginDesc:
      'Не удалось войти автоматически. Откройте приложение через бота в Telegram и повторите попытку.',
    loginBtn: 'Войти',
    ownerRole: '(владелец)',
    statusSuffix: 'Pro 2026',
    balanceTitle: (used: number, limit: number) =>
      `Суточный баланс: использовано ${used} из ${limit} задач`,
    expand: 'Развернуть на весь экран',
    exitFs: 'Свернуть в стандартный вид',
    admin: 'Админ-панель',
    logout: 'Сбросить сессию',
    sessionResetTitle: 'Сессия сброшена',
    sessionResetDesc: 'Вход выполнен заново',
    loginFailed: 'Вход не выполнен',
    // ── Кнопка ℹ️ «Шпаргалка по режимам» в шапке ──
    modesHint: 'Как работают 3 режима',
  },
  // ── Модалка «Шпаргалка: как работают 3 режима» (отзыв владельца: путаница вкладок) ──
  modes: {
    title: 'Шпаргалка: как работают 3 режима',
    intro: 'Один сервис — три разных конвейера. Выбирайте вкладку под задачу.',
    source: 'Источник',
    result: 'Результат',
    audience: 'Кому',
    hooksMode: '🎯 ИИ-хуки (Opus Clip)',
    hooksSource: 'Длинное видео 20–60 мин: YouTube, TikTok, VK, RuTube…',
    hooksResult: '3 разных готовых Shorts НА ВЫБОР — смонтируйте любой или все сразу',
    hooksAudience: 'Стримерам, судам, подкастам',
    shortsMode: '📱 Монтаж Shorts (9:16)',
    shortsSource: '1 файл или ссылка — конкретный клип',
    shortsResult: '1 оформленный вертикальный ролик: субтитры, обложка, сочный ТВ-звук',
    shortsAudience: 'Авторам Reels и Shorts',
    longMode: '🖥️ Монтаж Long (16:9)',
    longSource: 'Горизонтальное видео: заседание, лекция, стрим',
    longResult: 'Готовое видео: паузы вырезаны, кликабельные главы, ТВ-звук',
    longAudience: 'YouTube-каналам',
    tip: 'Совет: не знаете, с чего начать — начните с «ИИ-хуков»: ИИ сам найдёт лучшие моменты.',
    gotIt: 'Понятно',
  },
  tabs: {
    hooks: 'ИИ-хуки',
    shorts: 'Shorts',
    long: 'Long',
    showcase: 'Витрина',
    tasks: 'Задачи',
    hooksLong: 'ИИ-хуки (Opus Clip)',
    showcaseLong: 'Витрина работ',
    tasksLong: 'Мои задачи',
    sectionsAria: 'Разделы приложения',
    navAria: 'Основная навигация',
  },
  // ── Селектор целевой длительности (YouTube Shorts до 3 мин с 15.10.2024) ──
  dur: {
    hooksLabel: 'Длительность готовых Shorts',
    shortsLabel: 'Длительность готового ролика',
    short: '⚡ До 60 сек',
    shortHint: 'быстрый клип: TikTok / Reels / классический Shorts',
    standard: '⏱️ 60–90 сек',
    standardHint: 'стандартная мысль / комментарий',
    deep: '🎬 До 3 минут',
    deepHint: 'Глубокий Shorts · стандарт YouTube Shorts 2026: суды, интервью',
  },
  // ── Персональный онбординг для каждой вкладки (без ложных обещаний) ──
  onboarding: {
    dismiss: 'Скрыть подсказку',
    tabs: {
      hooks: {
        title: 'ИИ-хуки — как это работает',
        steps: [
          'Вставь ссылку на длинное видео (YouTube, TikTok, VK…) и выбери длительность.',
          'ИИ найдёт 3 отдельных готовых ролика — у каждого своя оценка Virality.',
          'Смонтируй любой в 1 клик — или забери все 3 сразу в очередь.',
        ],
      },
      shorts: {
        title: 'Монтаж Shorts — как это работает',
        steps: [
          'Загрузи один файл или ссылку — результат: ОДИН вертикальный ролик.',
          'Выбери пресет стиля, титулы, субтитры и кадр обложки.',
          'Нажми кнопку — забери готовый ролик в Telegram.',
        ],
      },
      long: {
        title: 'Монтаж Long — как это работает',
        steps: [
          'Загрузи горизонтальное видео — заседание, лекцию, стрим.',
          'ИИ вырежет паузы, сделает субтитры и кликабельные главы с таймкодами.',
          'Нажми кнопку — забери готовое видео 16:9 в Telegram.',
        ],
      },
    },
  },
  hooks: {
    title: 'ИИ-хуки (Opus Clip)',
    subtitle: 'Найду моменты, которые набирают просмотры',
    sourceLabel: 'Источник — ссылка на длинное видео (20–60 мин)',
    placeholder: 'Ссылка: youtube.com · tiktok.com · instagram.com…',
    find: 'Найти хуки',
    analyzing: 'Анализирую…',
    chip1: '🔊 Только аудио — быстро',
    chip2: '🗣 Понимает речь по секундам',
    chip3: '🧠 ИИ подберёт фрагменты под выбранную длительность',
    platformChip: '📱 1000+ сайтов: YouTube, TikTok, Insta, VK…',
    detected: (p: string) => `Распознано: ${p} ✓`,
    queueHint: (pos: number) => `В очереди · позиция ${pos} — ваш приоритет высший`,
    runHint: 'ИИ разбирает речь по секундам, затем оценит фрагменты',
    bestMoments: 'Лучшие моменты',
    nFragments: (n: number) => `${n} фрагмента`,
    virality: 'Virality',
    sec: 'с',
    breakdownTitle: 'Хук в первые 3 с · Завершённость · Эмоции · Удержание',
    bdHook: 'Хук',
    bdIdea: 'Мысль',
    bdEmotion: 'Эмоции',
    bdRetention: 'Удерж.',
    mount: 'Смонтировать этот фрагмент в 1 клик',
    preview: 'Превью 10 сек',
    previewTitle: (n: number) => `Фрагмент #${n} · превью`,
    previewNote: 'Первые 10 секунд — так зритель увидит ролик в ленте',
    thumbAria: 'Кадр фрагмента',
    titleVariants: 'Варианты названия',
    variantHint: 'Нажми — этот текст станет титулом ролика',
    variantChosen: (v: string) => `Титул: «${v}»`,
    emptyTitle: 'Хуков пока нет',
    emptyDesc:
      'Вставьте ссылку на заседание, интервью или стрим — ИИ найдёт 3–5 фрагментов с максимальным вирусным потенциалом и оценит их Virality Score.',
    rendered: 'Смонтированные фрагменты',
    renderedDone: 'Готово · видео в чате и в «Задачах»',
    needLinkTitle: 'Нужна ссылка',
    needLinkDesc: 'Вставьте ссылку на длинное видео — YouTube, TikTok, Instagram и 1000+ сайтов',
    badLinkTitle: 'Не похоже на ссылку',
    badLinkDesc: 'Нужен адрес, начинающийся с https:// — например, youtube.com/watch?v=…',
    startedTitle: '🎯 Анализ запущен',
    startedDesc:
      'Скачаю только аудио → ИИ распознает речь по секундам → оценит фрагменты. Кандидаты появятся здесь через пару минут.',
    queuedTitle: (rank: number, score: number) => `🎬 Shorts #${rank} в очереди · ${score}%`,
    queuedDesc: (tc: string) => `Фрагмент ${tc} — фирменный монтаж 1080×1920`,
    failTitle: 'Не получилось',
    failAnalyze: 'Не удалось запустить анализ',
    failRender: 'Ошибка постановки в очередь',
    analysisLabel: 'Анализ видео',
    // ── Тонкая подстройка таймкода (аудит UX: как Trim/Extend в Opus Clip) ──
    adjustLabel: 'Подправить границы — если ИИ чуть промахнулся',
    startLabel: 'Начало',
    endLabel: 'Конец',
    nudgeBtn: (d: number) => `${d > 0 ? '+' : '−'}${Math.abs(d)} с`,
    nudgeDone: 'Границы подправлены',
    nudgeDoneDesc: (tc: string) => `Фрагмент теперь ${tc}`,
    adjustedBadge: '✂️ подправлено',
    durationLabel: 'длит.',
    // ── Копирование цитаты в 1 клик ──
    copyQuote: 'Скопировать цитату',
    quoteCopied: 'Цитата в буфере',
    quoteCopiedDesc: 'Вставьте в описание или комментарий',
    // ── Микро-бейджи карточек ──
    badgeTop: '🔥 Топ-хук',
    badgePreview: '10 сек',
    // ── Микро-шаги ожидания анализа (NN/g: perceived progress) ──
    stepAudio: 'Скачиваю только аудио',
    stepTranscribe: 'Распознаю речь по секундам',
    stepScore: 'Оцениваю фрагменты и вирусность',
    // ── Бейдж «3 отдельных ролика на выбор» + массовый монтаж (отзыв владельца) ──
    foundBadge: (n: number) => `Найдено ${n} отдельных ${n >= 5 ? 'роликов' : 'ролика'} на выбор`,
    mountAll: (n: number) => `Смонтировать ВСЕ ${n} ${n >= 5 ? 'роликов' : 'ролика'} в очередь`,
    mountAllDoneTitle: 'Все ролики в очереди 🎬',
    mountAllDoneDesc: 'Готовые MP4 бот пришлёт в чат по одному',
  },
  shorts: {
    title: 'Монтаж Shorts',
    subtitle: 'Вертикаль 1080×1920 · субтитры 2–3 строки · сочный ТВ-звук',
    presetsLabel: 'Пресеты стиля — в 1 клик',
    presetViral: '🔥 Вирусный Shorts',
    presetViralHint: 'кликбейтный титул + двойные субтитры',
    presetPodcast: '🎙️ Подкаст / Блог',
    presetPodcastHint: 'чистый голос, спокойный кадр',
    presetLaw: '⚖️ Разбор / Право',
    presetLawHint: 'для судебных разборов КСУ',
    presetAppliedTitle: 'Пресет применён',
    presetAppliedDesc: 'Поля заполнены автоматически — поправьте титул и жмите кнопку',
    presetViralTitle: 'ЭТО НАДО УСЛЫШАТЬ',
    presetViralOverlay: 'SHORTS • 2026',
    presetViralPill: 'СМОТРИ ДО КОНЦА',
    presetPodcastTitle: 'Честный разговор',
    presetPodcastOverlay: 'ПОДКАСТ • выпуск',
    presetPodcastPill: 'ПОДКАСТ',
    presetLawTitle: 'Разбор дела',
    presetLawOverlay: 'КСУ • сегодня',
    presetLawPill: 'ЧТО ЭТО ИЗМЕНИТ?',
    featSound: '🔊 Сочный ТВ-звук',
    featSoundDesc: 'Чистый и громкий голос на любом динамике телефона',
    featReach: '🇺🇦➡️🇷🇺 Двойной охват',
    featReachDesc: 'Украинская речь + русские субтитры на подложке',
    featCover: '🖼️ Кликбейтный стоп-кадр',
    featCoverDesc: 'Выбери лицо с яркой эмоцией для обложки',
    featCut: '✂️ Авто-вырезка',
    featCutDesc: 'Неловкие паузы и вздохи будут удалены',
    groupSource: 'Источник',
    groupTitles: 'Титры и плашка',
    groupSubs: 'Субтитры',
    groupEnhance: 'Улучшения монтажа',
    groupCover: 'Кадр обложки · 1080×1920',
    optSilence: '✂️ Вырезать паузы и вздохи',
    optSilenceDesc: 'Тишина и «э-э…» убираются — ролик плотнее',
    optSfx: '🥁 Тихие SFX-акценты',
    optSfxDesc: 'Едва слышные whoosh на склейках — как у топовых блогеров',
    optMusic: '🎵 Фоновая музыка',
    optMusicDesc: 'Сама приглушается под голос — речи не мешает',
    optDub: '🗣 Дубляж RU⇄UA',
    optDubDesc: 'Голос переводится на другой язык, оригинал остаётся фоном',
    titlePlaceholder1: 'Титул · строка 1',
    titlePlaceholder2: 'Титул · строка 2',
    overlayPlaceholder: 'КСУ • 29.09.2026',
    pillPlaceholder: 'ЩО ЦЕ ЗМІНЮЄ?',
    titlesNote: 'Титул рендерится сверху кадра, плашка — на обложке 1080×1920.',
    speechLang: 'Язык речи',
    subLang: 'Язык субтитров',
    langUk: 'Украинская',
    langRu: 'Русская',
    langEn: 'English',
    subRu: 'Русские',
    subUk: 'Украинские',
    subOff: 'Без субтитров',
    bilingual: 'Двуязычный режим',
    bilingualDesc: 'Речь українською → русские субтитры',
    coverPosition: 'Позиция кадра',
    clipLengthLabel: 'Длительность клипа, сек',
    clipLengthHint: 'сек — длина клипа для расчёта таймкода кадра',
    previewLabel: 'Предпросмотр 1080×1920',
    cta: 'Поставить в очередь рендера',
    usedToday: (used: number, limit: number) =>
      `Использовано сегодня: ${used}/${limit} задач · бот пришлёт final.mp4 в чат`,
    progressNote: 'Прогресс — во вкладке «Задачи», уведомления приходят в Telegram.',
    needFile: 'Прикрепите видеофайл',
    needUrl: 'Вставьте ссылку на видео',
    queuedTitle: 'Задача в очереди 🎬',
    queuedDesc: 'Бот пришлёт статусы: нарезка → рендер → готово',
    failQueue: 'Не удалось поставить задачу',
    coverAria: 'Предпросмотр кадра обложки',
    // ── Живой скраббинг кадра обложки (аудит UX: как выбор обложки в CapCut) ──
    scrubLive: 'Живой выбор кадра',
    scrubLiveHint: 'Ведите ползунок — кадр меняется как в плеере',
    scrubFallback: 'Превью-кадр (пример)',
    scrubFallbackHint: 'Прикрепите файл — кадры будут из вашего видео',
    scrubBadge: 'LIVE',
  },
  long: {
    title: 'Монтаж Long',
    subtitle: 'Заседания и лекции 1280×720 · субтитры и главы автоматически',
    groupSource: 'Источник',
    groupGaps: 'Вырезка пауз и тишины',
    groupTranscript: 'Транскрипция и главы',
    gapsLabel: 'Паузы длиннее',
    sec: 'сек',
    padLabel: 'Отступ при склейке',
    gapsNote: '✂️ Авто-вырезка: уберём неловкие паузы и вздохи — ролик станет динамичнее. Меньше порог — больше динамики.',
    modelLabel: 'Качество распознавания речи',
    modelFast: 'Быстрое — экономит ресурсы',
    modelBest: 'Максимальное (рекомендуется)',
    chapters: 'Главы и таймкоды',
    chaptersDesc: 'Готовое оглавление в описании YouTube',
    metaTitle: 'Название для YouTube (необязательно)',
    metaPlaceholder: 'Судове засідання у Запоріжжі',
    cta: 'Поставить в очередь рендера',
    usedToday: (used: number, limit: number) => `Использовано сегодня: ${used}/${limit} задач`,
    progressNote: 'Готовое видео с субтитрами и обложкой бот пришлёт в чат. Прогресс — во вкладке «Задачи».',
    subsNote: 'Субтитры и главы генерируются автоматически из распознанной речи.',
    needFile: 'Прикрепите длинное видео или аудио',
    needUrl: 'Вставьте ссылку на запись',
    queuedTitle: 'Long-задача в очереди ⏳',
    queuedDesc: 'Каждый сегмент рендерится отдельно — качество без компромиссов',
    failQueue: 'Не удалось поставить задачу',
  },
  showcase: {
    title: 'Витрина',
    subtitle: 'Смонтировано автоматически: нарезки, заседания, лекции',
    bannerChip: 'Автоматический монтаж',
    bannerTitle: 'Работы «Монтажной Кухни»',
    bannerDesc: 'Реальные примеры: Shorts из суда, нарезки, длинные заседания с главами.',
    shortsSection: 'Shorts · 9:16',
    longSection: 'Горизонтальные · 16:9',
    dialogFallback: 'Пример работы движка',
    dialogNote: 'Смонтировано автоматически: субтитры, обложка, сочный ТВ-звук',
    dialogNoteLong: ' · вырезаны паузы',
    searchPlaceholder: 'Поиск по названию ролика…',
    filterAll: 'Все',
    filterShorts: '📱 Shorts (9:16)',
    filterLong: '🎬 16:9',
    filterCourts: '⚖️ Суды и КСУ',
    filterHowto: '📄 Инструкции',
    featuredTitle: 'Лучшие работы недели',
    featuredSub: 'обновляется по пятницам',
    featuredBadge: 'Выбор авторов',
    quickMount: 'Быстрый монтаж',
    mountSimilar: 'Смонтировать похожее',
    onYoutube: 'На YouTube',
    copyLink: 'Скопировать ссылку',
    linkCopied: 'Ссылка скопирована',
    share: 'Поделиться',
    emptyTitle: 'Ничего не нашлось',
    emptyDesc: 'Попробуйте другое название или сбросьте фильтры.',
    resetFilters: 'Сбросить фильтры',
    orderTitle: 'Смонтировать похожее',
    orderSub: 'Параметры подставятся в форму монтажа',
    orderFmt: 'Тип ролика',
    orderStyle: 'Стиль ролика',
    orderComment: 'Комментарий или пожелания',
    orderSend: 'Перейти к монтажу',
    orderDoneTitle: 'Стиль перенесён в форму',
    orderDoneDesc: 'Форма заполнена, можете добавить видео или ссылку.',
    openPrototype: '📱 Открыть Open Design прототип',
    // ── YouTube-пакет для авторов (аудит UX: пакетная загрузка без рутинного набора) ──
    copyPackage: 'YouTube-пакет',
    copyPackageFull: '📋 Скопировать YouTube-пакет',
    packageCopied: '📋 Пакет в буфере',
    packageCopiedDesc: 'Название, описание и теги — вставьте при загрузке на YouTube',
    pkgTitle: 'Название',
    pkgDescription: 'Описание',
    pkgTags: 'Теги',
  },
  tasks: {
    title: 'Мои задачи',
    subtitle: 'Один слот рендера — каждый ролик получается с полным качеством',
    onPipeline: 'На конвейере',
    history: 'История',
    stQueued: 'В очереди',
    stProcessing: 'В работе',
    stCompleted: 'Готово',
    stFailed: 'Ошибка',
    stCancelled: 'Отменено',
    waitingSlot: 'Ожидание слота рендера…',
    position: (n: number) => `Позиция: ${n}`,
    ramChip: (mb: string) => `ОЗУ ${mb} / 12 ГБ`,
    slotChip: 'Один слот рендера',
    cancel: 'Отменить задачу',
    cancelTitle: 'Задача отменена',
    cancelDesc: 'Слот рендера освобождён',
    cancelFail: 'Не удалось отменить',
    emptyTitle: 'Пока пусто',
    emptyDesc: 'Закажите монтаж во вкладке Shorts или Long — бот пришлёт готовый ролик сюда и в чат.',
    doneNote: 'Файл отправлен ботом в чат и продублирован ссылкой.',
    download: 'Скачать',
    video: 'Видео',
    shortFormat: 'Short · 1080×1920',
    longFormat: 'Long · 1280×720',
    sourceAria: 'Обложка результата',
    // ── Действия и заглушки по типам задач (отзыв владельца: пустые названия, битые превью) ──
    openHooks: '🎯 Открыть найденные хуки',
    downloadClip: '📥 Скачать ролик',
    typeShort: 'Short · 9:16',
    typeLong: 'Long · 16:9',
    typeHookAnalysis: 'Анализ хуков',
    typeHookRender: 'Хук → Shorts',
    formatAria: 'Формат результата',
  },
  source: {
    file: 'Файл',
    youtube: 'YouTube',
    link: 'Ссылка',
    aria: 'Источник видео',
    dropTitle: 'Нажмите или перетащите видео',
    dropHint: 'MP4, MKV, MOV · до 2 ГБ · аудио тоже подойдёт',
    removeFile: 'Убрать файл',
    urlPlaceholder: 'YouTube · TikTok · Instagram · Vimeo · X · VK…',
    urlAria: 'Ссылка на видео',
    detected: (p: string) => `Распознано: ${p} ✓`,
    anySite: 'Другой сайт — тоже попробуем (yt-dlp знает 1000+)',
  },
};

export type Messages = typeof ru;

const ua: Messages = {
  brand: 'Монтажна Кухня',
  header: {
    connecting: "З'єднуємось із кухнею монтажу…",
    loginDesc:
      'Не вдалось увійти автоматично. Відкрийте застосунок через бота в Telegram і спробуйте ще раз.',
    loginBtn: 'Увійти',
    ownerRole: '(власник)',
    statusSuffix: 'Pro 2026',
    balanceTitle: (used: number, limit: number) =>
      `Добовий баланс: використано ${used} із ${limit} завдань`,
    expand: 'Розгорнути на весь екран',
    exitFs: 'Згорнути у стандартний вигляд',
    admin: 'Адмін-панель',
    logout: 'Скинути сесію',
    sessionResetTitle: 'Сесію скинуто',
    sessionResetDesc: 'Вхід виконано знову',
    loginFailed: 'Вхід не виконано',
    // ── Кнопка ℹ️ «Шпаргалка по режимам» в шапці ──
    modesHint: 'Як працюють 3 режими',
  },
  // ── Модалка «Шпаргалка: як працюють 3 режими» (відгук власника: плутанина вкладок) ──
  modes: {
    title: 'Шпаргалка: як працюють 3 режими',
    intro: 'Один сервіс — три різні конвеєри. Обирайте вкладку під задачу.',
    source: 'Джерело',
    result: 'Результат',
    audience: 'Кому',
    hooksMode: '🎯 ШІ-хуки (Opus Clip)',
    hooksSource: 'Довге відео 20–60 хв: YouTube, TikTok, VK, RuTube…',
    hooksResult: '3 різних готових Shorts НА ВИБІР — змонтуйте будь-який або всі одразу',
    hooksAudience: 'Стримерам, судам, подкастам',
    shortsMode: '📱 Монтаж Shorts (9:16)',
    shortsSource: '1 файл або посилання — конкретний кліп',
    shortsResult: '1 оформлений вертикальний ролик: субтитри, обкладинка, соковитий ТВ-звук',
    shortsAudience: 'Авторам Reels і Shorts',
    longMode: '🖥️ Монтаж Long (16:9)',
    longSource: 'Горизонтальне відео: засідання, лекція, стрім',
    longResult: 'Готове відео: паузи вирізано, клікабельні глави, ТВ-звук',
    longAudience: 'YouTube-каналам',
    tip: 'Порада: не знаєте, з чого почати — почніть зі «ШІ-хуків»: ШІ сам знайде найкращі моменти.',
    gotIt: 'Зрозуміло',
  },
  tabs: {
    hooks: 'ШІ-хуки',
    shorts: 'Shorts',
    long: 'Long',
    showcase: 'Вітрина',
    tasks: 'Завдання',
    hooksLong: 'ШІ-хуки (Opus Clip)',
    showcaseLong: 'Вітрина робіт',
    tasksLong: 'Мої завдання',
    sectionsAria: 'Розділи застосунку',
    navAria: 'Основна навігація',
  },
  // ── Селектор цільової тривалості (YouTube Shorts до 3 хв з 15.10.2024) ──
  dur: {
    hooksLabel: 'Тривалість готових Shorts',
    shortsLabel: 'Тривалість готового ролика',
    short: '⚡ До 60 сек',
    shortHint: 'швидкий кліп: TikTok / Reels / класичний Shorts',
    standard: '⏱️ 60–90 сек',
    standardHint: 'стандартна думка / коментар',
    deep: '🎬 До 3 хвилин',
    deepHint: 'Глибокий Shorts · стандарт YouTube Shorts 2026: суди, інтервʼю',
  },
  // ── Персональний онбордінг для кожної вкладки (без хибних обіцянок) ──
  onboarding: {
    dismiss: 'Сховати підказку',
    tabs: {
      hooks: {
        title: 'ШІ-хуки — як це працює',
        steps: [
          'Встав посилання на довге відео (YouTube, TikTok, VK…) та обери тривалість.',
          'ШІ знайде 3 окремі готові ролики — у кожного своя оцінка Virality.',
          'Змонтуй будь-який в 1 клік — або забери всі 3 одразу в чергу.',
        ],
      },
      shorts: {
        title: 'Монтаж Shorts — як це працює',
        steps: [
          'Завантаж один файл або посилання — результат: ОДИН вертикальний ролик.',
          'Обери пресет стилю, титри, субтитри й кадр обкладинки.',
          'Натисни кнопку — забери готовий ролик у Telegram.',
        ],
      },
      long: {
        title: 'Монтаж Long — як це працює',
        steps: [
          'Завантаж горизонтальне відео — засідання, лекцію, стрім.',
          'ШІ виріже паузи, зробить субтитри й клікабельні глави з таймкодами.',
          'Натисни кнопку — забери готове відео 16:9 у Telegram.',
        ],
      },
    },
  },
  hooks: {
    title: 'ШІ-хуки (Opus Clip)',
    subtitle: 'Знайду моменти, що набирають переглядів',
    sourceLabel: 'Джерело — посилання на довге відео (20–60 хв)',
    placeholder: 'Посилання: youtube.com · tiktok.com · instagram.com…',
    find: 'Знайти хуки',
    platformChip: '📱 1000+ сайтів: YouTube, TikTok, Insta, VK…',
    detected: (p: string) => `Розпізнано: ${p} ✓`,
    analyzing: 'Аналізую…',
    chip1: '🔊 Лише аудіо — швидко',
    chip2: '🗣 Розуміє мовлення по секундах',
    chip3: '🧠 ШІ підбере фрагменти під обрану тривалість',
    queueHint: (pos: number) => `У черзі · позиція ${pos} — ваш пріоритет найвищий`,
    runHint: 'ШІ розбирає мовлення по секундах, потім оцінить фрагменти',
    bestMoments: 'Найкращі моменти',
    nFragments: (n: number) => `${n} фрагменти`,
    virality: 'Virality',
    sec: 'с',
    breakdownTitle: 'Хук у перші 3 с · Завершеність · Емоції · Утримання',
    bdHook: 'Хук',
    bdIdea: 'Думка',
    bdEmotion: 'Емоції',
    bdRetention: 'Утрим.',
    mount: 'Змонтувати цей фрагмент в 1 клік',
    preview: 'Превʼю 10 сек',
    previewTitle: (n: number) => `Фрагмент #${n} · превʼю`,
    previewNote: 'Перші 10 секунд — так глядач побачить ролик у стрічці',
    thumbAria: 'Кадр фрагмента',
    titleVariants: 'Варіанти назви',
    variantHint: 'Натисни — цей текст стане титулом ролика',
    variantChosen: (v: string) => `Титул: «${v}»`,
    emptyTitle: 'Хуків ще немає',
    emptyDesc:
      "Встав посилання на засідання, інтерв'ю чи стрім — ШІ знайде 3–5 фрагментів із максимальним вірусним потенціалом і оцінить їх Virality Score.",
    rendered: 'Змонтовані фрагменти',
    renderedDone: 'Готово · відео у чаті та в «Завданнях»',
    needLinkTitle: 'Потрібне посилання',
    needLinkDesc: 'Встав посилання на довге відео — YouTube, TikTok, Instagram і 1000+ сайтів',
    badLinkTitle: 'Не схоже на посилання',
    badLinkDesc: 'Потрібна адреса, що починається з https:// — наприклад, youtube.com/watch?v=…',
    startedTitle: '🎯 Аналіз запущено',
    startedDesc:
      "Завантажу лише аудіо → ШІ розпізнає мовлення по секундах → оцінить фрагменти. Кандидати з'являться тут за кілька хвилин.",
    queuedTitle: (rank: number, score: number) => `🎬 Shorts #${rank} у черзі · ${score}%`,
    queuedDesc: (tc: string) => `Фрагмент ${tc} — фірмовий монтаж 1080×1920`,
    failTitle: 'Не вийшло',
    failAnalyze: 'Не вдалось запустити аналіз',
    failRender: 'Помилка постановки в чергу',
    analysisLabel: 'Аналіз відео',
    // ── Тонке підлаштування таймкоду (аудит UX: як Trim/Extend в Opus Clip) ──
    adjustLabel: 'Підправити межі — якщо ШІ трохи промахнувся',
    startLabel: 'Початок',
    endLabel: 'Кінець',
    nudgeBtn: (d: number) => `${d > 0 ? '+' : '−'}${Math.abs(d)} с`,
    nudgeDone: 'Межі підправлено',
    nudgeDoneDesc: (tc: string) => `Фрагмент тепер ${tc}`,
    adjustedBadge: '✂️ підправлено',
    durationLabel: 'трив.',
    // ── Копіювання цитати в 1 клік ──
    copyQuote: 'Скопіювати цитату',
    quoteCopied: 'Цитата в буфері',
    quoteCopiedDesc: 'Вставте в опис або коментар',
    // ── Мікро-бейджі карток ──
    badgeTop: '🔥 Топ-хук',
    badgePreview: '10 сек',
    // ── Мікро-кроки очікування аналізу (NN/g: perceived progress) ──
    stepAudio: 'Завантажую лише аудіо',
    stepTranscribe: 'Розпізнаю мовлення по секундах',
    stepScore: 'Оцінюю фрагменти й вірусність',
    // ── Бейдж «3 окремі ролики на вибір» + масовий монтаж (відгук власника) ──
    foundBadge: (n: number) => `Знайдено ${n} окремих ${n >= 5 ? 'роликів' : 'ролики'} на вибір`,
    mountAll: (n: number) => `Змонтувати ВСІ ${n} ${n >= 5 ? 'роликів' : 'ролики'} в чергу`,
    mountAllDoneTitle: 'Всі ролики в черзі 🎬',
    mountAllDoneDesc: 'Готові MP4 бот надішле в чат по одному',
  },
  shorts: {
    title: 'Монтаж Shorts',
    subtitle: 'Вертикаль 1080×1920 · субтитри 2–3 рядки · соковитий ТВ-звук',
    presetsLabel: 'Пресети стилю — в 1 клік',
    presetViral: '🔥 Вірусний Shorts',
    presetViralHint: 'клікбейтний титул + подвійні субтитри',
    presetPodcast: '🎙️ Подкаст / Блог',
    presetPodcastHint: 'чистий голос, спокійний кадр',
    presetLaw: '⚖️ Розбір / Право',
    presetLawHint: 'для судових розборів КСУ',
    presetAppliedTitle: 'Пресет застосовано',
    presetAppliedDesc: 'Поля заповнено автоматично — виправте титул і тисніть кнопку',
    presetViralTitle: 'ЦЕ ТРЕБА ПОЧУТИ',
    presetViralOverlay: 'SHORTS • 2026',
    presetViralPill: 'ДИВИСЬ ДО КІНЦЯ',
    presetPodcastTitle: 'Чесна розмова',
    presetPodcastOverlay: 'ПОДКАСТ • випуск',
    presetPodcastPill: 'ПОДКАСТ',
    presetLawTitle: 'Розбір справи',
    presetLawOverlay: 'КСУ • сьогодні',
    presetLawPill: 'ЩО ЦЕ ЗМІНЮЄ?',
    featSound: '🔊 Соковитий ТВ-звук',
    featSoundDesc: 'Чистий і гучний голос на будь-якому динаміку телефону',
    featReach: '🇺🇦➡️🇷🇺 Подвійне охоплення',
    featReachDesc: 'Українське мовлення + російські субтитри на підкладці',
    featCover: '🖼️ Клікбейтний стоп-кадр',
    featCoverDesc: 'Обери обличчя з яскравою емоцією для обкладинки',
    featCut: '✂️ Авто-вирізка',
    featCutDesc: 'Незграбні паузи й вдихи буде видалено',
    groupSource: 'Джерело',
    groupTitles: 'Титри й плашка',
    groupSubs: 'Субтитри',
    groupEnhance: 'Покращення монтажу',
    groupCover: 'Кадр обкладинки · 1080×1920',
    optSilence: '✂️ Вирізати паузи й вдихи',
    optSilenceDesc: 'Тиша й «е-е…» прибираються — ролик щільніший',
    optSfx: '🥁 Тихі SFX-акценти',
    optSfxDesc: 'Ледь чутні whoosh на склейках — як у топових блогерів',
    optMusic: '🎵 Фонова музика',
    optMusicDesc: 'Сама приглушується під голос — мовленню не заважає',
    optDub: '🗣 Дубляж RU⇄UA',
    optDubDesc: 'Голос перекладається іншою мовою, оригінал лишається фоном',
    titlePlaceholder1: 'Титул · рядок 1',
    titlePlaceholder2: 'Титул · рядок 2',
    overlayPlaceholder: 'КСУ • 29.09.2026',
    pillPlaceholder: 'ЩО ЦЕ ЗМІНЮЄ?',
    titlesNote: 'Титул рендериться зверху кадру, плашка — на обкладинці 1080×1920.',
    speechLang: 'Мова мовлення',
    subLang: 'Мова субтитрів',
    langUk: 'Українська',
    langRu: 'Російська',
    langEn: 'English',
    subRu: 'Російські',
    subUk: 'Українські',
    subOff: 'Без субтитрів',
    bilingual: 'Двомовний режим',
    bilingualDesc: 'Мовлення українською → російські субтитри',
    coverPosition: 'Позиція кадру',
    clipLengthLabel: 'Тривалість кліпу, сек',
    clipLengthHint: 'сек — довжина кліпу для розрахунку таймкоду кадру',
    previewLabel: 'Попередній перегляд 1080×1920',
    cta: 'Поставити в чергу рендеру',
    usedToday: (used: number, limit: number) =>
      `Використано сьогодні: ${used}/${limit} завдань · бот надішле final.mp4 у чат`,
    progressNote: 'Прогрес — у вкладці «Завдання», повідомлення приходять у Telegram.',
    needFile: 'Прикріпіть відеофайл',
    needUrl: 'Встав посилання на відео',
    queuedTitle: 'Завдання в черзі 🎬',
    queuedDesc: 'Бот надішле статуси: нарізка → рендер → готово',
    failQueue: 'Не вдалось поставити завдання',
    coverAria: 'Попередній перегляд кадру обкладинки',
    // ── Живий скрабінг кадру обкладинки (аудит UX: як вибір обкладинки в CapCut) ──
    scrubLive: 'Живий вибір кадру',
    scrubLiveHint: 'Ведіть повзунок — кадр змінюється як у плеєрі',
    scrubFallback: 'Превʼю-кадр (приклад)',
    scrubFallbackHint: 'Прикріпіть файл — кадри будуть з вашого відео',
    scrubBadge: 'LIVE',
  },
  long: {
    title: 'Монтаж Long',
    subtitle: 'Засідання та лекції 1280×720 · субтитри й глави автоматично',
    groupSource: 'Джерело',
    groupGaps: 'Вирізання пауз і тиші',
    groupTranscript: 'Транскрипція й глави',
    gapsLabel: 'Паузи довші за',
    sec: 'сек',
    padLabel: 'Відступ при склейці',
    gapsNote: '✂️ Авто-вирізка: приберемо незграбні паузи й вдихи — ролик стане динамічнішим. Менший поріг — більше динаміки.',
    modelLabel: 'Якість розпізнавання мовлення',
    modelFast: 'Швидке — економить ресурси',
    modelBest: 'Максимальне (рекомендовано)',
    chapters: 'Глави й таймкоди',
    chaptersDesc: 'Готовий зміст в описі YouTube',
    metaTitle: 'Назва для YouTube (необовʼязково)',
    metaPlaceholder: 'Судове засідання у Запоріжжі',
    cta: 'Поставити в чергу рендеру',
    usedToday: (used: number, limit: number) => `Використано сьогодні: ${used}/${limit} завдань`,
    progressNote:
      'Готове відео із субтитрами й обкладинкою бот надішле в чат. Прогрес — у вкладці «Завдання».',
    subsNote: 'Субтитри й глави генеруються автоматично з розпізнаного мовлення.',
    needFile: 'Прикріпіть довге відео або аудіо',
    needUrl: 'Встав посилання на запис',
    queuedTitle: 'Long-завдання в черзі ⏳',
    queuedDesc: 'Кожен сегмент рендериться окремо — якість без компромісів',
    failQueue: 'Не вдалось поставити завдання',
  },
  showcase: {
    title: 'Вітрина',
    subtitle: 'Змонтовано автоматично: нарізки, засідання, лекції',
    bannerChip: 'Автоматичний монтаж',
    bannerTitle: 'Роботи «Монтажної Кухні»',
    bannerDesc: 'Реальні приклади: Shorts із суду, нарізки, довгі засідання з главами.',
    shortsSection: 'Shorts · 9:16',
    longSection: 'Горизонтальні · 16:9',
    dialogFallback: 'Приклад роботи рушія',
    dialogNote: 'Змонтовано автоматично: субтитри, обкладинка, соковитий ТВ-звук',
    dialogNoteLong: ' · видалено паузи',
    searchPlaceholder: 'Пошук за назвою ролика…',
    filterAll: 'Всі',
    filterShorts: '📱 Shorts (9:16)',
    filterLong: '🎬 16:9',
    filterCourts: '⚖️ Суди та КСУ',
    filterHowto: '📄 Інструкції',
    featuredTitle: 'Кращі роботи тижня',
    featuredSub: 'оновлюється щопʼятниці',
    featuredBadge: 'Вибір авторів',
    quickMount: 'Швидкий монтаж',
    mountSimilar: 'Змонтувати схоже',
    onYoutube: 'На YouTube',
    copyLink: 'Скопіювати посилання',
    linkCopied: 'Посилання скопійовано',
    share: 'Поділитися',
    emptyTitle: 'Нічого не знайдено',
    emptyDesc: 'Спробуйте іншу назву або скиньте фільтри.',
    resetFilters: 'Скинути фільтри',
    orderTitle: 'Змонтувати схоже',
    orderSub: 'Параметри підставляться у форму монтажу',
    orderFmt: 'Тип ролика',
    orderStyle: 'Стиль ролика',
    orderComment: 'Коментар або побажання',
    orderSend: 'Перейти до монтажу',
    orderDoneTitle: 'Стиль перенесено у форму',
    orderDoneDesc: 'Форму заповнено, можете додати відео або посилання.',
    openPrototype: '📱 Відкрити Open Design прототип',
    // ── YouTube-пакет для авторів (аудит UX: пакетне завантаження без рутини) ──
    copyPackage: 'YouTube-пакет',
    copyPackageFull: '📋 Скопіювати YouTube-пакет',
    packageCopied: '📋 Пакет у буфері',
    packageCopiedDesc: 'Назва, опис і теги — вставте при завантаженні на YouTube',
    pkgTitle: 'Назва',
    pkgDescription: 'Опис',
    pkgTags: 'Теги',
  },
  tasks: {
    title: 'Мої завдання',
    subtitle: 'Один слот рендеру — кожен ролик виходить з повною якістю',
    onPipeline: 'На конвеєрі',
    history: 'Історія',
    stQueued: 'У черзі',
    stProcessing: 'У роботі',
    stCompleted: 'Готово',
    stFailed: 'Помилка',
    stCancelled: 'Скасовано',
    waitingSlot: 'Очікування слоту рендеру…',
    position: (n: number) => `Позиція: ${n}`,
    ramChip: (mb: string) => `ОЗП ${mb} / 12 ГБ`,
    slotChip: 'Один слот рендеру',
    cancel: 'Скасувати завдання',
    cancelTitle: 'Завдання скасовано',
    cancelDesc: 'Слот рендеру звільнено',
    cancelFail: 'Не вдалося скасувати',
    emptyTitle: 'Поки порожньо',
    emptyDesc:
      'Замовте монтаж у вкладці Shorts або Long — бот надішле готовий ролик сюди й у чат.',
    doneNote: 'Файл надіслано ботом у чат і продубльовано посиланням.',
    download: 'Завантажити',
    video: 'Відео',
    shortFormat: 'Short · 1080×1920',
    longFormat: 'Long · 1280×720',
    sourceAria: 'Обкладинка результату',
    // ── Дії та заглушки за типами завдань (відгук власника: порожні назви, биті превʼю) ──
    openHooks: '🎯 Відкрити знайдені хуки',
    downloadClip: '📥 Завантажити ролик',
    typeShort: 'Short · 9:16',
    typeLong: 'Long · 16:9',
    typeHookAnalysis: 'Аналіз хуків',
    typeHookRender: 'Хук → Shorts',
    formatAria: 'Формат результату',
  },
  source: {
    file: 'Файл',
    youtube: 'YouTube',
    link: 'Посилання',
    aria: 'Джерело відео',
    dropTitle: 'Натисніть або перетягніть відео',
    dropHint: 'MP4, MKV, MOV · до 2 ГБ · аудіо теж підійде',
    removeFile: 'Прибрати файл',
    urlPlaceholder: 'YouTube · TikTok · Instagram · Vimeo · X · VK…',
    urlAria: 'Посилання на відео',
    detected: (p: string) => `Розпізнано: ${p} ✓`,
    anySite: 'Інший сайт — теж спробуємо (yt-dlp знає 1000+)',
  },
};

type I18nContextValue = { lang: Lang; setLang: (l: Lang) => void; t: Messages };

// ── Мини-стор языка ──────────────────────────────────────────────
// React 19 / eslint react-hooks: setState в теле эффекта запрещён.
// Язык живёт во внешнем сторе; компоненты подписаны через useSyncExternalStore.
// До первого монтирования всегда 'ru' — совпадает с SSR, гидратация без конфликтов.

let currentLang: Lang = 'ru';
const langListeners = new Set<() => void>();
let langInitialized = false;

function readStoredLang(): Lang | null {
  try {
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    if (saved === 'ru' || saved === 'ua') return saved;
    const nav = (navigator.language ?? '').toLowerCase();
    return nav.startsWith('uk') ? 'ua' : null;
  } catch {
    return null;
  }
}

/** Инициализация из localStorage/системного языка — однократно после монтирования. */
function initLang() {
  if (langInitialized) return;
  langInitialized = true;
  const stored = readStoredLang();
  if (stored && stored !== currentLang) {
    currentLang = stored;
    langListeners.forEach((cb) => cb());
  }
  try {
    document.documentElement.lang = currentLang;
  } catch {
    /* noop */
  }
}

function applyLang(l: Lang) {
  if (l !== currentLang) {
    currentLang = l;
    langListeners.forEach((cb) => cb());
  }
  try {
    localStorage.setItem(LANG_STORAGE_KEY, l);
    document.documentElement.lang = l;
  } catch {
    /* приватный режим */
  }
}

function useLang(): Lang {
  useEffect(() => {
    initLang();
  }, []);
  return useSyncExternalStore(
    (cb) => {
      langListeners.add(cb);
      return () => {
        langListeners.delete(cb);
      };
    },
    () => currentLang,
    () => 'ru' as Lang,
  );
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const lang = useLang();
  const setLang = useCallback((l: Lang) => applyLang(l), []);
  const value = useMemo<I18nContextValue>(
    () => ({ lang, setLang, t: lang === 'ua' ? ua : ru }),
    [lang, setLang],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n должен использоваться внутри LanguageProvider');
  return ctx;
}
