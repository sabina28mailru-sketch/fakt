import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Confidence, FeedKind, Level } from "./schema";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const WEEKDAYS_RU = [
  "Воскресенье",
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
];

const MONTHS_RU_GEN = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

/** "2026-09-18" → "18 сентября 2026" */
export function formatDateRu(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS_RU_GEN[m - 1]} ${y}`;
}

/** "2026-09-18" → "Пятница" */
export function weekdayRu(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return WEEKDAYS_RU[date.getUTCDay()];
}

/** Индекс рубрики: 0 = понедельник … 6 = воскресенье */
export function rubricIndex(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return (day + 6) % 7;
}

/** Локальная дата в формате ISO (ГГГГ-ММ-ДД) для заданного часового пояса */
export function todayIso(timeZone = "Asia/Almaty") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function formatTimeRu(isoDateTime: string, timeZone = "Asia/Almaty") {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(isoDateTime));
  } catch {
    return "";
  }
}

export const LEVEL_LABEL: Record<Level, string> = {
  world: "Мир",
  kz: "Казахстан",
  cis: "СНГ",
  science: "Наука",
};

/** Как называть тип темы ленты человеку. Рядом с прочими подписями: их тянет клиент. */
export const FEED_KIND_LABEL: Record<FeedKind, string> = {
  trend: "Тренд и новость",
  expert: "Экспертное объяснение",
  opinion: "Мнение и спор",
};

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: "Высокая",
  medium: "Средняя",
  low: "Низкая",
};

export function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function formatDuration(ms?: number) {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} с`;
  return `${Math.floor(s / 60)} мин ${s % 60} с`;
}

/** Русское склонение после числа: 1 факт, 2 факта, 5 фактов. */
export function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
