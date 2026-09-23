/**
 * Перенос данных из data/ в базу.
 *
 * Нужен один раз, при переезде на бессерверный хостинг: там файловая
 * система доступна только для чтения и обнуляется при каждом запуске,
 * поэтому выпуски, ленты, настройки и исследования должны лежать в базе.
 *
 * Запуск:
 *   DATABASE_URL="postgres://…" node scripts/migrate-to-db.mjs
 *   DATABASE_URL="postgres://…" node scripts/migrate-to-db.mjs --dry
 *
 * Повторный запуск безопасен: документы перезаписываются по ключу, дубликатов
 * не появляется. Файлы в data/ остаются на месте — скрипт только читает их.
 */
import { build } from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DRY = process.argv.includes("--dry");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Не задан DATABASE_URL. Пример:");
  console.error('  DATABASE_URL="postgres://…" node scripts/migrate-to-db.mjs');
  process.exit(1);
}

/** Собираем модуль на TypeScript в память: своего рантайма для TS у нас нет. */
async function load(relPath) {
  const out = join(mkdtempSync(join(tmpdir(), "fakt-migrate-")), "mod.mjs");
  await build({
    entryPoints: [join(ROOT, relPath)],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: out,
    // Драйвер собираем внутрь: временная папка сборки не видит node_modules.
    logLevel: "silent",
  });
  return import(pathToFileURL(out).href);
}

const { createFileStore } = await load("src/lib/store/docs-fs.ts");
const { createDbStore } = await load("src/lib/store/docs-db.ts");

const files = createFileStore();
const db = createDbStore(url);

// Виды в порядке, в котором их удобно читать в отчёте.
const KINDS = ["settings", "research", "usage", "edition", "feed"];

let moved = 0;
let skipped = 0;

for (const kind of KINDS) {
  const keys = await files.keys(kind);
  for (const key of keys) {
    const doc = await files.get(kind, key);
    if (doc === null) {
      // Единственные в своём роде могут просто отсутствовать — это штатно.
      skipped++;
      continue;
    }
    const size = JSON.stringify(doc).length;
    if (DRY) {
      console.log(`  [проба] ${kind}/${key} — ${(size / 1024).toFixed(1)} КБ`);
    } else {
      await db.put(kind, key, doc);
      console.log(`  ${kind}/${key} — перенесено, ${(size / 1024).toFixed(1)} КБ`);
    }
    moved++;
  }
}

console.log();
if (DRY) {
  console.log(`Проба: к переносу готово ${moved} документов, пропущено ${skipped}.`);
  console.log("Запустите без --dry, чтобы перенести на самом деле.");
} else {
  console.log(`Перенесено документов: ${moved}. Пропущено (нет файла): ${skipped}.`);
  // Сверяем, что в базе действительно столько же: молчаливая потеря
  // документа при переезде — худшее, что здесь может случиться.
  let inDb = 0;
  for (const kind of KINDS) inDb += (await db.keys(kind)).length;
  console.log(`В базе сейчас документов: ${inDb}.`);
  if (inDb < moved) {
    console.error("ВНИМАНИЕ: в базе меньше, чем перенесено. Проверьте вручную.");
    process.exit(1);
  }
  console.log("Файлы в data/ не тронуты — они остались как резервная копия.");
}
