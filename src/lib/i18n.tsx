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
  onboarding: {
    title: 'Как это работает — 3 шага',
    step1: 'Вставь ссылку (YouTube, TikTok, Instagram…) или загрузи файл.',
    step2: 'ИИ выберет 3 самых мощных момента (35–55 сек).',
    step3: 'Нажми одну кнопку ➔ забери готовый ролик прямо в Telegram.',
    dismiss: 'Скрыть подсказку',
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
    chip3: '🧠 ИИ ищет лучшие 35–55 сек',
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
  onboarding: {
    title: 'Як це працює — 3 кроки',
    step1: 'Встав посилання (YouTube, TikTok, Instagram…) або завантаж файл.',
    step2: 'ШІ обере 3 найпотужніші моменти (35–55 сек).',
    step3: 'Натисни одну кнопку ➔ забери готовий ролик просто в Telegram.',
    dismiss: 'Сховати підказку',
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
    chip3: '🧠 ШІ шукає найкращі 35–55 сек',
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
    orderDoneDesc: 'Форма заповнена, можете додати відео або посилання.',
    openPrototype: '📱 Відкрити Open Design прототип',
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
