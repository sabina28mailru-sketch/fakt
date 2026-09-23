/**
 * Признаки, из которых складывается балл достоверности.
 *
 * Разбор проекта показал перекос: из восьми сигналов кодом ограничивались
 * три, а оба штрафа были самодоносом — модель должна была сама сообщить,
 * что материал кликбейтный. На таких весах честная статья получала «низкая»,
 * а уверенный пост в соцсети мог набрать «высокую». Эти тесты сторожат ту
 * часть, которую удалось перевести на проверку кодом.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { loadLib } from "./helpers/load.mjs";

const { hasConcreteNumbers, isOfficialOrResearch, looksClickbait } = await loadLib("src/lib/page-guards.ts");

test("конкретика определяется по числам в тексте, а не со слов модели", () => {
  assert.equal(hasConcreteNumbers("Выборка 3484 человека, доля 41,4 процента"), true);
  assert.equal(hasConcreteNumbers("Рассуждения о важности личного бренда без единой цифры"), false);
});

test("одного числа для «конкретики» мало", () => {
  assert.equal(hasConcreteNumbers("В 2026 году всё изменится"), false);
});

test("научность и официальность подтверждаются доменом", () => {
  assert.equal(isOfficialOrResearch("https://doi.org/10.1234/abcd"), true);
  assert.equal(isOfficialOrResearch("https://stat.gov.kz/ru/industries/"), true);
  assert.equal(isOfficialOrResearch("https://www.nature.com/articles/x"), true);
  assert.equal(isOfficialOrResearch("https://vc.ru/marketing/1"), false);
  assert.equal(isOfficialOrResearch("не адрес"), false);
});

test("явный кликбейт код видит сам, без доноса модели", () => {
  assert.equal(looksClickbait("Шок: рынок рухнул за ночь"), true);
  assert.equal(looksClickbait("Вы не поверите, что случилось с охватами"), true);
  assert.equal(looksClickbait("Срочно!! Меняем стратегию"), true);
  assert.equal(looksClickbait("СЕКРЕТЫ ПРОДВИЖЕНИЯ ДЛЯ ЭКСПЕРТОВ"), true);
});

test("нормальный заголовок кликбейтом не считается", () => {
  assert.equal(looksClickbait("Как считать окупаемость B2B-маркетинга при долгом цикле сделки"), false);
  assert.equal(looksClickbait("Отчёт Edelman: доверие к экспертам выросло на 12%"), false);
  // Аббревиатуры не должны читаться как крик.
  assert.equal(looksClickbait("SMM и PR: что выбрать"), false);
});
