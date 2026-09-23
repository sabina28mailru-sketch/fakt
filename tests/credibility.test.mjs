/**
 * Балл достоверности: веса зафиксированы в коде, значит их можно и нужно
 * проверять счётом. Тест сторожит два обещания продукта:
 *   1. Число воспроизводимо — одни и те же признаки дают один и тот же балл.
 *   2. Авторская колонка не получает клеймо «низкая» просто за то, что она
 *      колонка, а не новость.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { loadLib } from "./helpers/load.mjs";

const { scoreCredibility, freshnessOf, ageInDays } = await loadLib("src/lib/credibility.ts");

/** Признаки типичной авторской колонки: автор есть, редакции и первоисточника нет. */
const column = {
  hasPrimarySource: false,
  independentConfirmations: 0,
  peerReviewedOrOfficial: false,
  outletReputable: false,
  authorKnown: true,
  hasConcreteEvidence: true,
  clickbaitMarkers: false,
  unverifiedClaims: false,
  quoteShowsIntersection: true,
};

/** Признаки крепкой новости: открытый первоисточник, подтверждения, издание. */
const news = {
  hasPrimarySource: true,
  independentConfirmations: 2,
  peerReviewedOrOfficial: false,
  outletReputable: true,
  authorKnown: true,
  hasConcreteEvidence: true,
  clickbaitMarkers: false,
  unverifiedClaims: false,
  quoteShowsIntersection: true,
};

test("балл воспроизводим: те же признаки — то же число", () => {
  const a = scoreCredibility(news, 3);
  const b = scoreCredibility(news, 3);
  assert.equal(a.score, b.score);
  assert.deepEqual(a.reasons, b.reasons);
});

test("крепкая свежая новость набирает высокий балл", () => {
  const r = scoreCredibility(news, 2);
  assert.ok(r.score >= 80, `ожидали не меньше 80, вышло ${r.score}`);
  assert.equal(r.label, "высокая");
});

test("колонку без поправки на жанр балл наказывает незаслуженно", () => {
  const r = scoreCredibility(column, 10);
  assert.ok(r.score < 60, `без поправки колонка должна падать ниже 60, вышло ${r.score}`);
});

test("с поправкой на жанр та же колонка перестаёт выглядеть браком", () => {
  const plain = scoreCredibility(column, 10);
  const asOpinion = scoreCredibility(column, 10, { opinion: true });
  assert.ok(
    asOpinion.score > plain.score,
    `поправка обязана поднимать балл: было ${plain.score}, стало ${asOpinion.score}`,
  );
  assert.notEqual(asOpinion.label, "низкая");
  // И объяснение обязано называть причину, а не молча менять число.
  assert.ok(
    asOpinion.reasons.some((x) => /авторского мнения|одному человеку|автор назван/.test(x)),
    "в причинах нет объяснения, почему для мнения считается иначе",
  );
});

test("поправка на жанр не превращает мусор в достоверное", () => {
  const junk = { ...column, authorKnown: false, hasConcreteEvidence: false, clickbaitMarkers: true };
  const r = scoreCredibility(junk, 400, { opinion: true });
  assert.ok(r.score < 60, `кликбейт без автора не должен проходить за среднее, вышло ${r.score}`);
});

test("свежесть считается по календарю, а не по настроению", () => {
  const now = new Date("2026-09-23T12:00:00Z");
  assert.equal(ageInDays("2026-09-23", now), 0);
  assert.equal(ageInDays("2026-09-16", now), 7);
  assert.equal(ageInDays("", now), null);
  assert.equal(ageInDays("не дата", now), null);
  assert.equal(freshnessOf(0), "days");
  assert.equal(freshnessOf(20), "weeks");
  assert.equal(freshnessOf(60), "months");
  assert.equal(freshnessOf(400), "older");
  assert.equal(freshnessOf(null), "unknown");
});

test("дата из будущего не даёт отрицательного возраста", () => {
  const now = new Date("2026-09-23T12:00:00Z");
  assert.equal(ageInDays("2026-12-01", now), 0);
});
