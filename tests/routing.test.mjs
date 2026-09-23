/**
 * Правила, по которым запрос уходит тому или иному провайдеру.
 *
 * Оба выведены из настоящих отказов Groq, а не из предположений:
 *   400 — «messages must contain the word json» при включённом режиме JSON;
 *   413/429 — «request too large» на запросе в 21 тысячу знаков.
 * Оба молчаливые: сборка и линтер их не видят, а прогон падает на шаге,
 * который к ошибке отношения не имеет.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { loadLib } from "./helpers/load.mjs";

const { siftRotation, writeRotation, rotationFor, FLASH_MODELS, GROQ_MODELS } = await loadLib("src/lib/rotation.ts");

test("разбор идёт на Groq первым: там суточный лимит на порядки больше", () => {
  const order = siftRotation("gemini-3.8-flash");
  // Без ключа Groq очередь состоит из одних моделей Gemini — это штатно.
  if (!process.env.GROQ_API_KEY) {
    assert.ok(order.every((r) => r.provider === "gemini"));
    return;
  }
  assert.equal(order[0].provider, "groq");
});

test("написание идёт на Gemini первым: это русский текст голосом владельца", () => {
  const order = writeRotation("gemini-3.8-flash", 0);
  assert.equal(order[0].provider, "gemini");
  assert.equal(order[0].model, "gemini-3.8-flash");
});

test("каждая тема начинает со своей модели, чтобы не делить одну квоту", () => {
  const first = writeRotation("gemini-3.8-flash", 0);
  const second = writeRotation("gemini-3.8-flash", 1);
  assert.notEqual(first[0].model, second[0].model);
});

test("выбранная в брифе модель всегда идёт первой среди Gemini", () => {
  for (const m of FLASH_MODELS) {
    assert.equal(rotationFor(m)[0], m, `для ${m} его же модель должна быть первой`);
  }
});

test("очередь не теряет моделей и не дублирует их", () => {
  const order = rotationFor("gemini-3.6-flash");
  assert.equal(order.length, FLASH_MODELS.length);
  assert.equal(new Set(order).size, order.length);
});

test("в списке Groq нет модели, которая перевирает цитаты", () => {
  // gpt-oss-20b на проверке переписала «считают» в «считаются» и обрезала
  // фразу. Код такую цитату отбросит, то есть вызов уйдёт впустую.
  // Проверяем точное имя, а не подстроку: «gpt-oss-120b» содержит «20b».
  assert.ok(!GROQ_MODELS.includes("openai/gpt-oss-20b"), `в списке есть 20b: ${GROQ_MODELS.join(", ")}`);
  assert.ok(GROQ_MODELS.length > 0);
});
