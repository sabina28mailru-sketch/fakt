import { z } from "zod";
import { DEFAULT_SOURCE_DOMAINS } from "./sources";

/* ---------- Выпуск ---------- */

export const ConfidenceSchema = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const LevelSchema = z.enum(["world", "kz", "cis", "science"]);
export type Level = z.infer<typeof LevelSchema>;

export const FactSchema = z.object({
  fact: z.string().min(1),
  source: z.string().min(1),
  url: z.string().min(1),
  date: z.string().min(1),
  level: LevelSchema,
  confidence: ConfidenceSchema,
  note: z.string().optional(),
});
export type Fact = z.infer<typeof FactSchema>;

export const StoryFrameSchema = z.object({
  n: z.number().int().positive(),
  text: z.string().min(1),
  visual: z.string().min(1),
  interactive: z.string().optional(),
});
export type StoryFrame = z.infer<typeof StoryFrameSchema>;

export const SlideSchema = z.object({
  n: z.number().int().positive(),
  title: z.string().min(1),
  body: z.string().min(1),
});
export type Slide = z.infer<typeof SlideSchema>;

export const ReelLineSchema = z.object({
  time: z.string().min(1),
  text: z.string().min(1),
});
export type ReelLine = z.infer<typeof ReelLineSchema>;

export const ExpertQuoteSchema = z.object({
  name: z.string().min(1),
  role: z.string().optional().default(""),
  source: z.string().min(1),
  url: z.string().min(1),
  date: z.string().optional().default(""),
  quote: z.string().min(1),
  note: z.string().optional().default(""),
});
export type ExpertQuote = z.infer<typeof ExpertQuoteSchema>;

export const BackupTopicSchema = z.object({
  title: z.string().min(1),
  url: z.string().min(1),
  note: z.string().optional().default(""),
});
export type BackupTopic = z.infer<typeof BackupTopicSchema>;

export const EditionSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().min(1),
  date: z.string().min(1),
  weekday: z.string().min(1),
  rubric: z.string().min(1),
  topic: z.object({
    title: z.string().min(1),
    whyNow: z.string().min(1),
  }),
  stories: z.object({
    frames: z.array(StoryFrameSchema).min(4).max(10),
  }),
  carousel: z.object({
    slides: z.array(SlideSchema).min(5).max(12),
    caption: z.string().min(1),
  }),
  reel: z.object({
    hook: z.string().min(1),
    script: z.array(ReelLineSchema).min(2),
    captions: z.array(z.string()),
    cta: z.string().min(1),
    caption: z.string().min(1),
  }),
  expertLens: z.array(ExpertQuoteSchema),
  facts: z.array(FactSchema).min(1),
  backupTopics: z.array(BackupTopicSchema),
  unverified: z.array(z.string()),
  meta: z.object({
    model: z.string(),
    generatedBy: z.enum(["pipeline", "manual"]).default("pipeline"),
    durationMs: z.number().optional(),
    searches: z.number().optional(),
    fetches: z.number().optional(),
    inputTokens: z.number().optional(),
    outputTokens: z.number().optional(),
  }),
});
export type Edition = z.infer<typeof EditionSchema>;

/** То, что должна вернуть модель на шаге «write» (всё, кроме служебных полей). */
export const EditionDraftSchema = EditionSchema.omit({
  id: true,
  createdAt: true,
  meta: true,
});
export type EditionDraft = z.infer<typeof EditionDraftSchema>;

/* ---------- Настройки / бриф ---------- */

export const SettingsSchema = z.object({
  model: z.string().min(1),
  maxSearches: z.number().int().min(3).max(40),
  maxFetches: z.number().int().min(0).max(30),
  /** Домены, которыми ограничен поиск. По умолчанию — списки из sources.ts. */
  sourceDomains: z
    .object({
      world: z.array(z.string()),
      kz: z.array(z.string()),
      cis: z.array(z.string()),
      science: z.array(z.string()),
    })
    .default(() => ({
      world: [...DEFAULT_SOURCE_DOMAINS.world],
      kz: [...DEFAULT_SOURCE_DOMAINS.kz],
      cis: [...DEFAULT_SOURCE_DOMAINS.cis],
      science: [...DEFAULT_SOURCE_DOMAINS.science],
    })),
  userLocation: z.object({
    country: z.string().length(2),
    city: z.string().min(1),
    timezone: z.string().min(1),
  }),
  brief: z.object({
    persona: z.string(),
    priorities: z.string(),
    sourcesWorld: z.string(),
    sourcesKz: z.string(),
    sourcesCis: z.string(),
    expertLens: z.string(),
    science: z.string(),
    verification: z.string(),
    topicRules: z.string(),
    rubrics: z.array(z.string()).length(7),
    voice: z.string(),
    formatStories: z.string(),
    formatCarousel: z.string(),
    formatReel: z.string(),
  }),
});
export type Settings = z.infer<typeof SettingsSchema>;

/* ---------- События пайплайна (SSE) ---------- */

export type StepId = "research" | "verify" | "write" | "validate" | "save";

export type PipelineEvent =
  | { type: "step"; step: StepId; status: "running" | "done" | "error"; detail?: string }
  | { type: "log"; kind: "search" | "fetch" | "result" | "info" | "warn"; text: string }
  | { type: "done"; edition: Edition }
  | { type: "error"; message: string };

/* ══════════════════════════════════════════════════════════════════
   Исследование темы. Отдельный от выпуска контур: пользователь задаёт
   произвольную тему, система ищет по ней и отчитывается источниками.
   ══════════════════════════════════════════════════════════════════ */

/** Роль источника в подтверждении материала. */
export const SourceKindSchema = z.enum(["primary", "research", "official", "publication"]);
export type SourceKind = z.infer<typeof SourceKindSchema>;

export const ResearchSourceSchema = z.object({
  title: z.string(),
  url: z.string(),
  outlet: z.string(),
  /** Пустая строка, если дату установить не удалось. Выдумывать дату нельзя. */
  date: z.string().default(""),
  kind: SourceKindSchema,
  /** Страницу открывали целиком, а не судили по сниппету. */
  opened: z.boolean().default(false),
});
export type ResearchSource = z.infer<typeof ResearchSourceSchema>;

/**
 * Отношение материала к запросу. `core` — прямое попадание в намерение,
 * `related` — честно связанный материал, помечается отдельно и никогда
 * не подменяет основную выдачу.
 */
export const RelationSchema = z.enum(["core", "related"]);
export type Relation = z.infer<typeof RelationSchema>;

export const FreshnessSchema = z.enum(["days", "weeks", "months", "older", "unknown"]);
export type Freshness = z.infer<typeof FreshnessSchema>;

export const CredibilitySchema = z.object({
  score: z.number().int().min(0).max(100),
  label: z.enum(["высокая", "средняя", "низкая"]),
  /** Человекочитаемые причины именно такого балла. */
  reasons: z.array(z.string()),
});
export type Credibility = z.infer<typeof CredibilitySchema>;

export const ResearchMaterialSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  summary: z.string().min(1),
  whyNow: z.string().default(""),
  facts: z.array(z.string()),
  date: z.string().default(""),
  outlet: z.string(),
  url: z.string(),
  relation: RelationSchema,
  /** Для related — чем именно материал связан с темой. */
  relationNote: z.string().default(""),
  /** Дословная цитата со страницы, подтверждающая связь с темой. */
  evidence: z.string().default(""),
  /** Какие понятия запроса реально найдены в тексте страницы. */
  conceptsFound: z.array(z.string()).default([]),
  sources: z.array(ResearchSourceSchema),
  confirmations: z.number().int().min(0),
  credibility: CredibilitySchema,
  freshness: FreshnessSchema,
});
export type ResearchMaterial = z.infer<typeof ResearchMaterialSchema>;

export const RejectedSchema = z.object({
  title: z.string(),
  url: z.string(),
  reason: z.string(),
});
export type Rejected = z.infer<typeof RejectedSchema>;

/**
 * Понятие запроса и его синонимы. Группировка принципиальна: «AI» и
 * «искусственный интеллект» — одно понятие, а не два требования. Плоский
 * список синонимов позволял странице про стоматологию набрать два совпадения
 * и пройти как соответствующая теме «AI в стоматологии».
 */
export const ConceptSchema = z.object({
  name: z.string().min(1),
  variants: z.array(z.string()),
});
export type Concept = z.infer<typeof ConceptSchema>;

export const ResearchIntentSchema = z.object({
  /** Как система поняла запрос. Показывается пользователю. */
  restated: z.string(),
  /** Понятия запроса. Материал обязан содержать ВСЕ, иначе это соседняя тема. */
  concepts: z.array(ConceptSchema).default([]),
  /** Плоский список для показа пользователю. */
  mustInclude: z.array(z.string()),
  /** Соседние темы, которые нельзя выдавать за основной результат. */
  notThis: z.array(z.string()),
});
export type ResearchIntent = z.infer<typeof ResearchIntentSchema>;

/** Пункт сводного ответа: утверждение и номера материалов, на которых оно держится. */
export const AnswerPointSchema = z.object({
  text: z.string().min(1),
  /** id материалов из этого же результата. Ссылки берутся только оттуда. */
  materialIds: z.array(z.string()),
});
export type AnswerPoint = z.infer<typeof AnswerPointSchema>;

export const ResearchAnswerSchema = z.object({
  /** Короткий прямой ответ на запрос. */
  summary: z.string().default(""),
  points: z.array(AnswerPointSchema).default([]),
  /** Что по теме осталось непонятным или спорным. */
  gaps: z.array(z.string()).default([]),
});
export type ResearchAnswer = z.infer<typeof ResearchAnswerSchema>;

export const ResearchResultSchema = z.object({
  id: z.string(),
  topic: z.string().min(1),
  createdAt: z.string(),
  intent: ResearchIntentSchema,
  materials: z.array(ResearchMaterialSchema),
  /** Сводный ответ по теме. Пустой, если материала не набралось. */
  answer: ResearchAnswerSchema.default({ summary: "", points: [], gaps: [] }),
  rejected: z.array(RejectedSchema),
  queries: z.array(z.string()),
  credits: z.number().int().min(0).default(0),
  /** Заполняется, когда качественного материала по теме мало. */
  shortfall: z.string().default(""),
});
export type ResearchResult = z.infer<typeof ResearchResultSchema>;

export const ResearchStoreSchema = z.object({
  tags: z.array(z.string()).default([]),
  results: z.array(ResearchResultSchema).default([]),
});
export type ResearchStore = z.infer<typeof ResearchStoreSchema>;

export type ResearchStepId = "intent" | "search" | "open" | "judge" | "answer";

export type ResearchEvent =
  | { type: "step"; step: ResearchStepId; status: "running" | "done" | "error"; detail?: string }
  | { type: "log"; kind: "search" | "fetch" | "result" | "info" | "warn"; text: string }
  | { type: "done"; result: ResearchResult }
  | { type: "error"; message: string };

/* ══════════════════════════════════════════════════════════════════
   Лента дня — раздел «Сегодня».

   Ровно три темы в день, ОБЯЗАТЕЛЬНО разных типов, у каждой — три
   направления контента и открытые источники. Тип выбирает не модель:
   его проставляет код при отборе, иначе на выходе получаются три
   вариации одной и той же темы.
   ══════════════════════════════════════════════════════════════════ */

/**
 * Тип темы. Три штуки не случайны: они отвечают на разные запросы
 * аудитории — что происходит, что полезно понять, о чём спорить.
 */
export const FeedKindSchema = z.enum(["trend", "expert", "opinion"]);
export type FeedKind = z.infer<typeof FeedKindSchema>;

export const FEED_KINDS: FeedKind[] = ["trend", "expert", "opinion"];

/** Направление контента: идея плюс готовая структура. */
export const FeedStoriesSchema = z.object({
  /** Идея сторителлинга одной фразой: что за история и чем она держит. */
  idea: z.string().min(1),
  frames: z.array(StoryFrameSchema).min(4).max(10),
});
export type FeedStories = z.infer<typeof FeedStoriesSchema>;

export const FeedCarouselSchema = z.object({
  idea: z.string().min(1),
  slides: z.array(SlideSchema).min(5).max(12),
  caption: z.string().min(1),
});
export type FeedCarousel = z.infer<typeof FeedCarouselSchema>;

export const FeedReelSchema = z.object({
  idea: z.string().min(1),
  /** Первые 2–3 секунды. Отдельное поле, потому что от него зависит всё остальное. */
  hook: z.string().min(1),
  script: z.array(ReelLineSchema).min(2),
  captions: z.array(z.string()),
  cta: z.string().min(1),
  caption: z.string().min(1),
});
export type FeedReel = z.infer<typeof FeedReelSchema>;

/**
 * Тема дня. Поля до `stories` — информационное основание: без них тема
 * в ленту не попадает. Пустой `sources` невозможен по схеме намеренно:
 * тема без открытого источника — это выдумка, а не тема.
 */
export const FeedTopicSchema = z.object({
  id: z.string().min(1),
  kind: FeedKindSchema,
  title: z.string().min(1),
  /** Неочевидный угол: чем эта подача отличается от общего места. */
  angle: z.string().min(1),
  /** Почему именно сейчас: инфоповод, на котором тема стоит. */
  whyNow: z.string().min(1),
  /** На какой вопрос аудитории тема отвечает. Для типа opinion — предмет спора. */
  audienceQuestion: z.string().default(""),
  /**
   * Факты с проверенными ссылками. Пустой массив возможен: не в каждом
   * материале есть цифры. Но пустоту нельзя показывать молча — интерфейс
   * обязан сказать, что проверяемых цифр в теме нет.
   */
  facts: z.array(FactSchema),
  /**
   * Источники темы. Только реально открытые страницы: адрес, который мы
   * не скачивали, сюда не попадает. Модель называет первоисточники, на
   * которые ссылается страница, но URL к ним она берёт из памяти — при
   * скачивании ссылки вырезаются вместе с разметкой, и проверить их нечем.
   */
  sources: z.array(ResearchSourceSchema).min(1),
  /**
   * Первоисточники, НАЗВАННЫЕ на странице: исследования, отчёты, документы.
   * Только названия, без ссылок — сославшись на них, владелец знает, что
   * искать, и не рискует поставить в пост выдуманный адрес.
   */
  mentions: z.array(z.string()).default([]),
  /** Дословная цитата с открытой страницы, подтверждающая основание темы. */
  evidence: z.string().default(""),
  credibility: CredibilitySchema,
  freshness: FreshnessSchema,
  /**
   * Что в готовом контенте код подтвердить НЕ смог: цифры, которых нет на
   * скачанных страницах, и рассказы от первого лица о том, чего система
   * знать не может. Пустой список — всё сошлось.
   *
   * Поле появилось после настоящего провала: в кадр сторис попало «рост в
   * 3,7-кратном темпе» (числа нет нигде) и «я вернулся с конференции в
   * Алматы» (владелец там не был), и рядом стояла настоящая ссылка.
   * Молчать о таком нельзя: подтверждённая с виду выдумка хуже, чем
   * честно непроверенное.
   */
  unverified: z.array(z.string()).default([]),
  stories: FeedStoriesSchema,
  carousel: FeedCarouselSchema,
  reel: FeedReelSchema,
});
export type FeedTopic = z.infer<typeof FeedTopicSchema>;

/** То, что пишет модель для одной темы: только контент, без проверенных полей. */
export const FeedTopicDraftSchema = z.object({
  title: z.string().min(1),
  angle: z.string().min(1),
  whyNow: z.string().min(1),
  audienceQuestion: z.string().default(""),
  facts: z.array(FactSchema),
  stories: FeedStoriesSchema,
  carousel: FeedCarouselSchema,
  reel: FeedReelSchema,
});
export type FeedTopicDraft = z.infer<typeof FeedTopicDraftSchema>;

/**
 * Почему тип темы остался пустым. Причину пишет КОД по своим счётчикам,
 * а не модель: «не нашлось основания» и «кончилась квота» — это разные
 * беды с разными действиями, и человек обязан их различать.
 */
export const FeedGapSchema = z.object({
  kind: FeedKindSchema,
  reason: z.string().min(1),
  /** true — виновата квота или сеть, есть смысл повторить прямо сейчас. */
  retryable: z.boolean().default(false),
});
export type FeedGap = z.infer<typeof FeedGapSchema>;

export const DailyFeedSchema = z.object({
  id: z.string().min(1),
  date: z.string().min(1),
  weekday: z.string().min(1),
  createdAt: z.string().min(1),
  /** Обычно три. Меньше — только когда материала честно не хватило, тогда заполнен shortfall. */
  topics: z.array(FeedTopicSchema),
  /** Чего не хватило: заполняется, когда тем меньше трёх. Молча недодавать нельзя. */
  shortfall: z.string().default(""),
  /** Пустые типы с причиной. По ним рисуются карточки «добрать тему». */
  gaps: z.array(FeedGapSchema).default([]),
  /**
   * Понятия ниши, по которым код проверял каждую страницу. Хранятся, чтобы
   * отказ можно было объяснить: «на странице нет ни одного понятия вашей
   * ниши» — проверяемое утверждение, а не мнение модели.
   */
  niche: z.array(ConceptSchema).default([]),
  queries: z.array(z.string()).default([]),
  meta: z.object({
    model: z.string(),
    durationMs: z.number().optional(),
    searches: z.number().optional(),
    fetches: z.number().optional(),
    credits: z.number().optional(),
    modelCalls: z.number().optional(),
  }),
});
export type DailyFeed = z.infer<typeof DailyFeedSchema>;

export type FeedStepId = "agenda" | "search" | "open" | "select" | "write";

export type FeedEvent =
  | { type: "step"; step: FeedStepId; status: "running" | "done" | "error"; detail?: string }
  | { type: "log"; kind: "search" | "fetch" | "result" | "info" | "warn"; text: string }
  | { type: "topic"; topic: FeedTopic }
  | { type: "done"; feed: DailyFeed }
  | { type: "error"; message: string };

/* ---------- Расход внешних сервисов ---------- */

/**
 * Сколько потрачено за календарный месяц. Кошелёк у трёх конвейеров общий:
 * лента, выпуск и исследование берут кредиты Tavily из одного тарифа, а
 * увидеть остаток было негде — первым сигналом становился отказ поиска.
 * Счётчик обнуляется сменой месяца: тарифы у Tavily тоже месячные.
 */
export const UsageSchema = z.object({
  /** ГГГГ-ММ. Не совпал с текущим — счётчики начинаются заново. */
  month: z.string().default(""),
  tavilyCredits: z.number().int().min(0).default(0),
  modelCalls: z.number().int().min(0).default(0),
  runs: z.number().int().min(0).default(0),
});
export type Usage = z.infer<typeof UsageSchema>;
