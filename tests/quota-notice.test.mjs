/**
 * Сообщение о том, что выбранная модель кончилась.
 *
 * Подмена модели работает молча и правильно, но у сообщения о ней два
 * способа стать вредным, и оба проверяются здесь.
 *
 * Соврать. Механические шаги уходят на Groq по замыслу, а не от нехватки
 * квоты. Строка «Gemini кончился» в этом месте отправила бы владельца
 * ждать полуночи, хотя ждать нечего.
 *
 * Засорить. У прогона пять вызовов моделей; если сообщать при каждом,
 * получится ровно тот шум, ради избавления от которого лог и чистили.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { loadLib } from "./helpers/load.mjs";

const { createQuotaNotice } = await loadLib("src/lib/quota-notice.ts");

const QUOTA = "gemini-3.8-flash — суточная квота модели исчерпана (на бесплатном тарифе — 20 запросов в сутки на каждую)";

test("про выбранную модель с кончившейся квотой сообщаем", () => {
  const notice = createQuotaNotice("gemini-3.8-flash");
  const said = notice([QUOTA]);
  assert.ok(said, "молчать здесь нельзя: дальше пишет запасная модель");
  assert.match(said, /квота/i);
});

test("сообщаем один раз за прогон, а не на каждый вызов", () => {
  const notice = createQuotaNotice("gemini-3.8-flash");
  assert.ok(notice([QUOTA]));
  assert.equal(notice([QUOTA]), null, "второй раз — это уже шум");
  assert.equal(notice([QUOTA]), null);
});

test("отказ ДРУГОЙ модели выбранную не оговаривает", () => {
  // Разбор страниц уходит на Groq по замыслу. Его минутный лимит — не повод
  // объявлять, что кончился Gemini, который в этом шаге и не участвовал.
  const notice = createQuotaNotice("gemini-3.8-flash");
  const alien = "groq/gpt-oss-120b — упёрлась в минутный лимит токенов";
  assert.equal(notice([alien]), null);
});

test("не квота — не повод для сообщения", () => {
  // У отказа по сети или по формату другие причины и другие действия.
  const notice = createQuotaNotice("gemini-3.8-flash");
  assert.equal(notice(["gemini-3.8-flash — связь оборвалась"]), null);
  assert.equal(notice(["gemini-3.8-flash — модель ответила не в том формате"]), null);
});

test("минутный лимит молчит: он проходит сам за секунды", () => {
  // Ловушка в тексте: сообщение про минутный лимит само содержит слово
  // «суточная» — «минутный лимит бесплатного тарифа, суточная квота при
  // этом цела». Поиска одного слова здесь недостаточно.
  const notice = createQuotaNotice("gemini-3.8-flash");
  const minute = "gemini-3.8-flash — минутный лимит бесплатного тарифа, суточная квота при этом цела";
  assert.equal(notice([minute]), null, "из-за минутной паузы нельзя объявлять день законченным");
  // И после этого сообщение не считается израсходованным: настоящая
  // суточная квота ещё должна быть объявлена.
  assert.ok(notice([QUOTA]));
});

test("пустой список отказов ничего не печатает", () => {
  const notice = createQuotaNotice("gemini-3.8-flash");
  assert.equal(notice([]), null);
});

test("выбранный Groq узнаётся по имени, но минутный лимит его не хоронит", () => {
  // Владелец мог поставить Groq основным. Его ограничение — минутное,
  // и «на сегодня выбрано» про него было бы просто неправдой.
  const notice = createQuotaNotice("groq/gpt-oss-120b");
  assert.equal(notice(["groq/gpt-oss-120b — упёрлась в минутный лимит токенов"]), null);
  assert.equal(notice(["gemini-3.8-flash — суточная квота модели исчерпана"]), null, "чужой отказ — не его беда");
});

test("имя модели в брифе с лишними пробелами узнаётся", () => {
  const notice = createQuotaNotice("  gemini-3.8-flash  ");
  assert.ok(notice([QUOTA]), "пробелы при копировании не должны отключать сообщение");
});
