/**
 * Ошибки внешних сервисов, как их видит владелец.
 *
 * Повод вполне конкретный: на экране висело двенадцать строк подряд вида
 *
 *   Запрос не прошёл: стратегия построения личного бренда — Tavily ответил
 *   401: { "detail": { "error": "Unauthorized: missing or invalid API key." } }
 *
 * по одной на каждый поисковый запрос. Человек, который собирает контент,
 * не обязан читать JSON, чтобы понять, что ключ не принят.
 *
 * Поэтому здесь проверяется не «есть ли текст», а два свойства: в сообщении
 * нет сырого ответа сервиса, и по нему понятно, что делать.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { loadLib } from "./helpers/load.mjs";

const { searchError, pageError } = await loadLib("src/lib/errors.ts");

/** Признаки того, что наружу просочился машинный ответ. */
function looksLikeCode(text) {
  return /[{}[\]]|"[a-z_]+"\s*:|https?:\/\/|Unauthorized|error/i.test(text);
}

test("ни одна ошибка поиска не показывает сырой ответ сервиса", () => {
  for (const status of [400, 401, 403, 429, 432, 433, 500, 503, 418]) {
    const text = searchError(status);
    assert.ok(!looksLikeCode(text), `код ${status} протёк наружу: ${text}`);
    assert.ok(text.length > 20, `слишком коротко, чтобы понять причину: ${text}`);
  }
});

test("отказ по ключу и отказ по лимиту — разные советы", () => {
  // Спутать их дорого: при неверном ключе ждать бесполезно, а при минутном
  // лимите бесполезно перевыпускать ключ.
  assert.match(searchError(401), /ключ/i);
  assert.match(searchError(403), /ключ/i);
  assert.match(searchError(429), /лимит|часто/i);
  assert.ok(!/ключ/i.test(searchError(429)), "минутный лимит не должен подозревать ключ");
});

test("исчерпанные кредиты названы кредитами, а не ошибкой", () => {
  // 432 и 433 у Tavily — про кончившийся тариф. Совет «проверьте ключ»
  // здесь отправил бы чинить то, что исправно.
  for (const status of [432, 433]) {
    assert.match(searchError(status), /кредит/i);
  }
});

test("сторона отказа названа: их сбой или наша настройка", () => {
  assert.match(searchError(500), /их стороне|повторить/i);
});

test("причина, почему страница не открылась, звучит по-человечески", () => {
  const cases = [
    ["Failed to fetch url", /не отдал/i],
    ["Request timed out", /вовремя/i],
    ["403 Forbidden", /закрыт/i],
    ["404 Not Found", /больше нет/i],
  ];
  for (const [raw, expected] of cases) {
    const text = pageError(raw);
    assert.match(text, expected, `для «${raw}» вышло «${text}»`);
    assert.ok(!/[A-Za-z]{4,}/.test(text), `осталось английское слово: ${text}`);
  }
});

test("незнакомая причина не роняет и не протекает", () => {
  const text = pageError("SomethingCompletelyNew: 0x80004005");
  assert.ok(text.length > 0);
  assert.ok(!/0x80004005/.test(text), `внутренний код виден пользователю: ${text}`);
});
