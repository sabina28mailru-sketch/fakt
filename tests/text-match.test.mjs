/**
 * Сверка сказанного моделью с текстом страницы. На этом модуле держатся два
 * обещания продукта сразу: «цитата настоящая» и «материал про вашу нишу».
 * Его же используют и лента, и раздел «Темы» — значит строгость у них общая,
 * и проверять её надо в одном месте.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { loadLib } from "./helpers/load.mjs";

const { evidenceInText, conceptInText, titleOverlap } = await loadLib("src/lib/text-match.ts");

const PAGE =
  "Исследование Edelman показало, что 73% руководителей считают контент лидеров мнений " +
  "надёжнее маркетинговых материалов. Выборка — 3484 человека в 14 странах, март 2026 года.";

test("дословная цитата со страницы принимается", () => {
  assert.equal(evidenceInText("73% руководителей считают контент лидеров мнений надёжнее", PAGE), true);
});

test("цитата переживает разную типографику", () => {
  // Модель то поправит тире, то уберёт пробел — точное сравнение давало ложные отказы.
  assert.equal(evidenceInText("«73% руководителей считают контент лидеров мнений надёжнее»", PAGE), true);
  assert.equal(evidenceInText("Выборка  —  3484 человека в 14 странах", PAGE), true);
});

test("выдуманная цитата не проходит", () => {
  assert.equal(evidenceInText("81% руководителей отказались от рекламы совсем", PAGE), false);
});

test("пересказ своими словами не считается цитатой", () => {
  // Ровно этим грешит gpt-oss-20b: смысл тот же, слова другие.
  assert.equal(evidenceInText("Большинство руководителей доверяют лидерам мнений больше рекламы", PAGE), false);
});

test("слишком короткий обрывок не принимается за подтверждение", () => {
  assert.equal(evidenceInText("73%", PAGE), false);
  assert.equal(evidenceInText("", PAGE), false);
});

test("понятие находится в тексте через склонение", () => {
  const concept = { name: "лидер мнений", variants: ["лидеры мнений", "thought leader"] };
  assert.equal(conceptInText(concept, PAGE), true);
});

test("понятия, которого нет, на странице не находится", () => {
  const concept = { name: "стоматология", variants: ["dental", "зубной врач"] };
  assert.equal(conceptInText(concept, PAGE), false);
});

test("короткий термин не ловится внутри другого слова", () => {
  // «PR» внутри «природа» давало ложное совпадение.
  assert.equal(conceptInText({ name: "PR", variants: [] }, "природа и приборы"), false);
  assert.equal(conceptInText({ name: "PR", variants: [] }, "занимается PR и рекламой"), true);
});

test("повтор темы ловится по смыслу, а не по буквам", () => {
  const a = "Instagram меняет правила подсчёта просмотров";
  const b = "Как Instagram изменил подсчёт просмотров";
  assert.ok(titleOverlap(a, b) >= 0.6, `ожидали совпадение не ниже 0.6, вышло ${titleOverlap(a, b)}`);
});

test("разные темы не считаются повтором", () => {
  const a = "Instagram меняет правила подсчёта просмотров";
  const b = "Доверие к экспертам в Казахстане выросло";
  assert.ok(titleOverlap(a, b) < 0.6, `ожидали меньше 0.6, вышло ${titleOverlap(a, b)}`);
});
