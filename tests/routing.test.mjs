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

const {
  siftRotation,
  writeRotation,
  rotationFor,
  geminiRotation,
  refFromName,
  modelChoices,
  FLASH_MODELS,
  GROQ_MODELS,
  FAST_MODEL,
} = await loadLib("src/lib/rotation.ts");

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

test("выбранная в брифе модель всегда идёт первой", () => {
  for (const m of FLASH_MODELS) {
    assert.equal(rotationFor(m)[0].model, m, `для ${m} его же модель должна быть первой`);
  }
});

test("очередь не теряет моделей и не дублирует их", () => {
  const order = rotationFor("gemini-3.6-flash");
  // Все флагманские плюс лёгкая замыкающей.
  assert.equal(order.length, FLASH_MODELS.length + 1);
  const keys = order.map((r) => `${r.provider}:${r.model}`);
  assert.equal(new Set(keys).size, keys.length, `есть дубли: ${keys.join(", ")}`);
  for (const m of FLASH_MODELS) assert.ok(order.some((r) => r.model === m), `потеряна ${m}`);
});

test("лёгкая модель замыкает очередь, а не открывает её", () => {
  // У неё суточная квота на порядок больше, но слог слабее: она запас,
  // а не первый выбор. Без неё все четыре flash выбирались до конца,
  // и прогон падал, хотя запас ещё был.
  const order = rotationFor("gemini-3.8-flash");
  assert.equal(order[order.length - 1].model, FAST_MODEL);
  assert.ok(!FLASH_MODELS.includes(FAST_MODEL), "лёгкая не должна числиться флагманской");
});

/* ---------- Groq как основная модель ---------- */

test("имя из брифа распознаётся: groq/ — это Groq, остальное — Gemini", () => {
  const short = refFromName("groq/gpt-oss-120b");
  assert.equal(short.provider, "groq");
  // Полный путь из документации Groq понимаем тоже.
  assert.equal(refFromName("openai/gpt-oss-120b").provider, "groq");
  assert.equal(refFromName("openai/gpt-oss-120b").model, short.model);
  assert.equal(refFromName("gemini-3.8-flash").provider, "gemini");
  // Лишние пробелы при копировании — обычное дело, не повод уронить прогон.
  assert.equal(refFromName("  gemini-3.8-flash  ").model, "gemini-3.8-flash");
});

test("в брифе предлагаются и Gemini, и Groq", () => {
  const list = modelChoices();
  assert.ok(list.some((m) => m.startsWith("gemini-")), "пропали модели Gemini");
  assert.ok(list.some((m) => m.startsWith("groq/")), "Groq нельзя выбрать — ради этого всё и делалось");
  assert.equal(new Set(list).size, list.length, `есть дубли: ${list.join(", ")}`);
});

test("выбранный владельцем Groq идёт первым и в разборе, и в написании", () => {
  if (!process.env.GROQ_API_KEY) return; // без ключа очередь законно пуста
  const name = "groq/gpt-oss-120b";
  for (const order of [rotationFor(name), siftRotation(name), writeRotation(name, 0)]) {
    assert.equal(order[0].provider, "groq", "выбор владельца обязан идти первым");
  }
  // Смысл выбора — «квота Gemini кончилась». Возвращаться к ней сразу после
  // первой неудачи значило бы не услышать этот выбор.
  assert.equal(writeRotation(name, 1)[0].provider, "groq", "ротация по темам не должна отменять выбор");
});

test("для длинного входа очередь только из Gemini", () => {
  // Groq отвергает большой запрос по лимиту токенов в минуту, поэтому шаг
  // сверки фактов (там весь текст открытых страниц) к нему не ходит вовсе.
  for (const name of ["gemini-3.8-flash", "groq/gpt-oss-120b"]) {
    assert.ok(
      geminiRotation(name).every((r) => r.provider === "gemini"),
      `в очереди для длинного входа оказался не Gemini (${name})`,
    );
  }
});

test("запас есть и в очереди на написание", () => {
  const order = writeRotation("gemini-3.8-flash", 0);
  assert.equal(order[order.length - 1].model, FAST_MODEL);
});

test("в списке Groq нет модели, которая перевирает цитаты", () => {
  // gpt-oss-20b на проверке переписала «считают» в «считаются» и обрезала
  // фразу. Код такую цитату отбросит, то есть вызов уйдёт впустую.
  // Проверяем точное имя, а не подстроку: «gpt-oss-120b» содержит «20b».
  assert.ok(!GROQ_MODELS.includes("openai/gpt-oss-20b"), `в списке есть 20b: ${GROQ_MODELS.join(", ")}`);
  assert.ok(GROQ_MODELS.length > 0);
});
