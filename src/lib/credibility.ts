import type { Credibility, Freshness } from "./schema";

/**
 * Оценка надёжности найденного материала.
 *
 * Балл считает код, а не модель. Модель сообщает только то, что можно
 * увидеть на странице (есть ли первоисточник, сколько независимых
 * подтверждений, есть ли кликбейт), а веса зафиксированы здесь. Иначе
 * число было бы вымыслом: у модели нет способа откалибровать «87 из 100».
 *
 * Важно: это оценка НАДЁЖНОСТИ ИСТОЧНИКОВ, а не гарантия истинности.
 */

/** Признаки, которые извлекаются из открытой страницы. */
export interface CredibilitySignals {
  /** Первоисточник (официальный документ, исследование, пресс-релиз) найден и открыт. */
  hasPrimarySource: boolean;
  /** Сколько независимых изданий подтверждают те же факты. */
  independentConfirmations: number;
  /** Рецензируемое исследование или официальная статистика. */
  peerReviewedOrOfficial: boolean;
  /** Издание известно и имеет редакционную ответственность. */
  outletReputable: boolean;
  /** Указан автор с проверяемой принадлежностью. */
  authorKnown: boolean;
  /** В материале есть конкретика: числа, даты выборки, цитаты, документы. */
  hasConcreteEvidence: boolean;
  /** Кликбейт: обещания в заголовке, не подтверждённые текстом. */
  clickbaitMarkers: boolean;
  /** Утверждения без ссылки и без данных. */
  unverifiedClaims: boolean;
  /** Цитата со страницы показывает связь темы целиком, а не одну её сторону. */
  quoteShowsIntersection?: boolean;
}

/** Сколько дней назад опубликовано. null — дату установить не удалось. */
export function ageInDays(date: string, now: Date): number | null {
  if (!date) return null;
  const t = Date.parse(date);
  if (Number.isNaN(t)) return null;
  const days = Math.floor((now.getTime() - t) / 86_400_000);
  return days < 0 ? 0 : days;
}

export function freshnessOf(days: number | null): Freshness {
  if (days === null) return "unknown";
  if (days <= 7) return "days";
  if (days <= 30) return "weeks";
  if (days <= 90) return "months";
  return "older";
}

const BASE = 40;

export interface ScoreOptions {
  /**
   * Материал — авторское мнение или колонка, а не сообщение о факте.
   *
   * Это не поблажка, а другой вопрос к источнику. У новости спрашивают
   * «правда ли это и чем подтверждено». У колонки — «действительно ли
   * человек это сказал и кто он такой». Требовать от мнения первоисточник
   * и независимые подтверждения бессмысленно: мнение по определению одно
   * и принадлежит одному человеку. Без этой поправки тип «мнение и спор»
   * получал 28–43 из 100 всегда, и низкий балл читался как «недостоверно»,
   * хотя означал лишь «это другой жанр».
   */
  opinion?: boolean;
}

export function scoreCredibility(
  signals: CredibilitySignals,
  days: number | null,
  opts: ScoreOptions = {},
): Credibility {
  let score = BASE;
  const reasons: string[] = [];

  const add = (points: number, text: string) => {
    score += points;
    const sign = points > 0 ? `+${points}` : `${points}`;
    reasons.push(`${sign} ${text}`);
  };

  if (signals.hasPrimarySource) add(20, "первоисточник найден и открыт");
  else if (opts.opinion) reasons.push("0 первоисточника нет — у авторского мнения его и не бывает");
  else add(-8, "первоисточник не найден");

  const confirms = Math.max(0, Math.min(3, signals.independentConfirmations));
  if (confirms > 0) {
    add(confirms * 5, `независимых подтверждений: ${signals.independentConfirmations}`);
  } else if (opts.opinion) {
    reasons.push("0 подтверждений нет — мнение по определению принадлежит одному человеку");
  } else {
    add(-6, "независимых подтверждений нет");
  }

  if (signals.peerReviewedOrOfficial) add(10, "рецензируемое исследование или официальная статистика");
  if (signals.outletReputable) add(6, "издание с редакционной ответственностью");
  // Для колонки названный автор — это и есть главная опора: мнение без
  // имени не стоит ничего, а мнение с именем можно проверить и оспорить.
  if (signals.authorKnown) add(opts.opinion ? 12 : 3, opts.opinion ? "автор назван — мнение можно отнести к человеку" : "указан автор");
  if (signals.hasConcreteEvidence) add(6, "в тексте есть конкретика: числа, выборка, цитаты");
  if (signals.quoteShowsIntersection) add(4, "цитата со страницы показывает связь темы целиком");

  if (signals.clickbaitMarkers) add(-15, "признаки кликбейта: заголовок обещает больше, чем в тексте");
  if (signals.unverifiedClaims) add(-12, "есть утверждения без ссылки и без данных");

  if (days === null) {
    add(-10, "дату публикации установить не удалось");
  } else if (days <= 7) {
    add(10, `опубликовано ${days === 0 ? "сегодня" : `${days} дн. назад`}`);
  } else if (days <= 30) {
    add(7, `опубликовано ${days} дн. назад`);
  } else if (days <= 90) {
    add(4, `опубликовано ${days} дн. назад`);
  } else if (days <= 365) {
    reasons.push(`0 материалу ${days} дн., для темы это ещё в пределах актуального`);
  } else {
    add(-6, `материалу больше года (${days} дн.)`);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const label: Credibility["label"] = score >= 80 ? "высокая" : score >= 60 ? "средняя" : "низкая";
  return { score, label, reasons };
}

/** Короткое объяснение под баллом — первые и самые весомые причины. */
export function credibilitySummary(c: Credibility): string {
  const positives = c.reasons.filter((r) => r.startsWith("+"));
  const negatives = c.reasons.filter((r) => r.startsWith("-"));
  const head = positives.slice(0, 2).map(stripSign);
  const tail = negatives.slice(0, 2).map(stripSign);
  if (head.length && tail.length) return `${head.join(", ")}. Но: ${tail.join(", ")}.`;
  if (head.length) return `${head.join(", ")}.`;
  if (tail.length) return `${tail.join(", ")}.`;
  return "Признаков для оценки почти нет.";
}

function stripSign(reason: string): string {
  return reason.replace(/^[+-]\d+\s*/, "");
}
