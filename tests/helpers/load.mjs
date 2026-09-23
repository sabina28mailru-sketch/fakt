/**
 * Загрузка модуля на TypeScript в тест на чистом Node.
 *
 * Своего рантайма для TS у нас нет и заводить его ради тестов не хочется:
 * esbuild уже стоит в зависимостях ради сборки превью, и его достаточно.
 * Собираем модуль в память, пишем во временный файл и импортируем.
 */
import { build } from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Путь относительно корня проекта, например "src/lib/credibility.ts". */
export async function loadLib(relPath) {
  const out = join(mkdtempSync(join(tmpdir(), "fakt-test-")), "mod.mjs");
  await build({
    entryPoints: [join(ROOT, relPath)],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: out,
    logLevel: "silent",
  });
  return import(pathToFileURL(out).href);
}

export { ROOT };
