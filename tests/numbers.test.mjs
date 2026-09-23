/**
 * Сверка цифр из готового контента со страницей.
 *
 * Тест построен на настоящем провале: в ленте за 23 сентября кадр сторис
 * сообщал «Рост в 3,7-кратном темпе» — числа 3,7 не было ни на странице,
 * ни в фактах, ни в цитате, и оно не получается делением 13,52 на 1,23.
 * Рядом стояла проверенная ссылка, и выдумка выглядела подтверждённой.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { loadLib } from "./helpers/load.mjs";

const { claimNumbers, numberOnPages, checkNumbers, firstPersonClaims } = await loadLib("src/lib/numbers.ts");

const PAGE =
  "По данным Brand Analytics, в августе 2026 года лидером стал Instagram: 4,75 млн авторов " +
  "и 43,88 млн сообщений. Threads — 1,23 млн авторов и 13,52 млн сообщений. " +
  "Казахоязычный контент в Facebook составляет 41,4 % всех сообщений.";

test("мелкие целые не проверяются: это структура речи, а не утверждение", () => {
  // «3 шага», «за 2 минуты», «кадр 5» не обязаны стоять на странице.
  assert.deepEqual(claimNumbers("Разберём это за 3 шага и 2 минуты"), []);
});

test("дробные и крупные числа берутся на проверку", () => {
  const found = claimNumbers("Instagram: 4,75 млн авторов, 43,88 млн сообщений за 2026 год");
  assert.ok(found.includes("4.75"));
  assert.ok(found.includes("43.88"));
  assert.ok(found.includes("2026"));
});

test("запятая и точка как разделитель — одно и то же число", () => {
  assert.equal(numberOnPages("4.75", [PAGE]), true);
  assert.equal(numberOnPages("41.4", [PAGE]), true);
});

test("настоящий провал: выдуманное число не проходит", () => {
  const frames = [
    { where: "сторис, кадр 3", text: "Threads: 1,23 млн авторов, 13,52 млн сообщений. Рост в 3,7‑кратном темпе." },
  ];
  const bad = checkNumbers(frames, [PAGE]);
  assert.equal(bad.length, 1, `ожидали ровно одно непроверенное число, вышло ${JSON.stringify(bad)}`);
  assert.equal(bad[0].value, "3.7");
  assert.equal(bad[0].where, "сторис, кадр 3");
});

test("числа, которые на странице есть, помехой не становятся", () => {
  const frames = [{ where: "сторис, кадр 2", text: "Instagram: 4,75 млн авторов, 43,88 млн сообщений за месяц." }];
  assert.deepEqual(checkNumbers(frames, [PAGE]), []);
});

test("несколько страниц: число с любой из них засчитывается", () => {
  const other = "Отдельное исследование: охват вырос на 12,5 процента.";
  const frames = [{ where: "карусель, слайд 4", text: "Охват вырос на 12,5 %, авторов 4,75 млн." }];
  assert.deepEqual(checkNumbers(frames, [PAGE, other]), []);
});

test("настоящий провал: рассказ о том, чего не было", () => {
  // Владелец опубликовал бы от первого лица, что был на конференции.
  const frames = [
    { where: "сторис, кадр 1", text: "Я только что вернулся с Brand Analytics Conference в Алматы." },
  ];
  const found = firstPersonClaims(frames);
  assert.equal(found.length, 1);
  assert.equal(found[0].where, "сторис, кадр 1");
});

test("обычная речь от первого лица предупреждением не считается", () => {
  const frames = [
    { where: "сторис, кадр 1", text: "Я вижу, как традиционный поиск отходит на задний план." },
    { where: "сторис, кадр 2", text: "Я разбирал это с клиентами и считаю подход рабочим." },
  ];
  assert.deepEqual(firstPersonClaims(frames), []);
});
