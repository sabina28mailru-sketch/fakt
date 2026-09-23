import type { FeedStepId, StepId } from "./schema";

/**
 * Описание шага для панели прогресса. Панель одна на все конвейеры:
 * у выпуска, ленты и исследования разные шаги, но одинаковое устройство
 * показа — заводить вторую панель значило бы держать два похожих
 * интерфейса и чинить каждую правку дважды.
 */
export interface StepDef<Id extends string = string> {
  id: Id;
  title: string;
  hint: string;
  /** Доля прогона. Сумма по списку обязана давать 1. */
  weight: number;
}

export const STEPS: (StepDef<StepId> & { id: StepId })[] = [
  { weight: 0.4, id: "research", title: "Ресерч", hint: "Мир · Казахстан · СНГ · экспертная линза" },
  { weight: 0.25, id: "verify", title: "Проверка", hint: "Открывает первоисточники, отсеивает неподтверждённое" },
  { weight: 0.2, id: "write", title: "Тема и три формата", hint: "Сторис · карусель · рилс по рубрике дня" },
  { weight: 0.05, id: "validate", title: "Проверка структуры", hint: "Схема выпуска, лимиты кадров и слайдов" },
  { weight: 0.1, id: "save", title: "Сохранение", hint: "data/editions/ГГГГ-ММ-ДД.json" },
];

/**
 * Шаги ленты дня. Веса — по замеру: отбор оснований и написание тем занимают
 * большую часть прогона, потому что в них печатается длинный JSON.
 */
export const FEED_STEPS: (StepDef<FeedStepId> & { id: FeedStepId })[] = [
  { weight: 0.08, id: "agenda", title: "Повестка", hint: "Запросы по трём типам тем" },
  { weight: 0.14, id: "search", title: "Поиск", hint: "Свежие публикации по нише" },
  { weight: 0.14, id: "open", title: "Открытие", hint: "Страницы целиком, не сниппеты" },
  { weight: 0.56, id: "select", title: "Разбор материалов", hint: "Цитата сверяется с текстом страницы" },
  { weight: 0.08, id: "write", title: "Сборка тем", hint: "Факты сверяются с текстом страниц" },
];
