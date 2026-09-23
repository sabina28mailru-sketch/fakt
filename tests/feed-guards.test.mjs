/**
 * Кодовые гарантии ленты: что она НЕ пропустит и что НЕ выбросит.
 *
 * Каждый случай здесь поймал живой прогон, а не воображение. Это и есть
 * причина держать их тестами: молчаливая поломка любого из них не роняет
 * сборку, не видна линтеру и обнаруживается только по странному результату
 * через неделю.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { loadLib } from "./helpers/load.mjs";

const { isFeedPage, sameUrl, pageDate } = await loadLib("src/lib/page-guards.ts");

test("страница тегов темой не становится", () => {
  // Реальный случай: это встало в ленту как тема типа «мнение и спор».
  assert.equal(
    isFeedPage("#authenticmarketing #personalbranding #aiinmarketing - LinkedIn", "https://www.linkedin.com/feed/hashtag/x"),
    true,
  );
  assert.equal(isFeedPage("Публикации по теме маркетинг", "https://vc.ru/tag/marketing"), true);
  assert.equal(isFeedPage("Все материалы автора", "https://kapital.kz/author/ivanov"), true);
});

test("обычная статья не принимается за витрину", () => {
  assert.equal(isFeedPage("Почему видео руководителей даёт больше охвата", "https://kapital.kz/business/122/video.html"), false);
  assert.equal(isFeedPage("Отчёт Edelman: доверие выросло", "https://edelman.com/trust/2026"), false);
});

test("«tag» внутри слова не считается тегом", () => {
  // Проверка по подстроке выбрасывала бы «montage», «vintage», «advantage».
  assert.equal(isFeedPage("Монтаж и постпродакшн: разбор", "https://example.com/montage/guide"), false);
  assert.equal(isFeedPage("Преимущества формата", "https://example.com/advantages/list"), false);
});

test("адреса сравниваются без косметики", () => {
  // Живой прогон: из четырёх фактов доезжал один, потому что модель
  // добавляла слеш или теряла utm-хвост.
  assert.equal(sameUrl("https://vc.ru/a/1", "https://vc.ru/a/1/"), true);
  assert.equal(sameUrl("https://www.vc.ru/a/1", "https://vc.ru/a/1?utm_source=x"), true);
  assert.equal(sameUrl("https://vc.ru/a/1", "https://vc.ru/a/2"), false);
  assert.equal(sameUrl("https://vc.ru/a/1", "https://other.ru/a/1"), false);
});

test("дата из выдачи поиска имеет приоритет над датой от модели", () => {
  // Модель называет вчерашнее число, поиск — настоящее. Верим поиску.
  assert.equal(pageDate("2026-09-22", "2026-03-01", "текст страницы"), "2026-03-01");
});

test("дата от модели принимается, только если она есть на странице", () => {
  assert.equal(pageDate("2026-09-18", undefined, "Опубликовано 2026-09-18, автор..."), "2026-09-18");
  assert.equal(pageDate("2026-09-18", undefined, "Опубликовано 18.09.2026"), "2026-09-18");
  assert.equal(pageDate("2026-09-18", undefined, "Опубликовано 18 сентября"), "2026-09-18");
});

test("выдуманная дата отбрасывается, а не украшает материал", () => {
  // От даты зависят свежесть и +10 к баллу — у модели прямой стимул её подрисовать.
  assert.equal(pageDate("2026-09-22", undefined, "на странице про дату ни слова"), "");
  assert.equal(pageDate("не дата", undefined, "текст"), "");
  assert.equal(pageDate(undefined, undefined, "текст"), "");
});
