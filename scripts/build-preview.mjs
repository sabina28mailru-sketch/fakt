/**
 * Собирает статическое превью интерфейса в preview/index.html:
 * один файл, внутри — стили и JS-бандл, данные вшиты на этапе сборки.
 * Используется, чтобы показать интерфейс без запуска сервера (например, как артефакт).
 *
 *   node scripts/build-preview.mjs
 */
import * as esbuild from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "preview");
mkdirSync(out, { recursive: true });

// 1. JS-бандл
await esbuild.build({
  entryPoints: [path.join(root, "src/preview/entry.tsx")],
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2020"],
  jsx: "automatic",
  tsconfig: path.join(root, "tsconfig.json"),
  define: {
    "process.env.NODE_ENV": '"production"',
    "process.env.NEXT_PUBLIC_PREVIEW": '"1"',
  },
  outfile: path.join(out, "bundle.js"),
  logLevel: "info",
});

// 2. CSS через Tailwind CLI (v4 сам находит исходники в проекте).
// Запускаем .mjs напрямую через node: на Windows spawnSync не умеет .cmd-обёртки npx без shell.
const twCli = path.join(root, "node_modules", "@tailwindcss", "cli", "dist", "index.mjs");
execFileSync(
  process.execPath,
  [twCli, "-i", "src/app/globals.css", "-o", "preview/styles.css", "--minify"],
  { cwd: root, stdio: "inherit" },
);

// 3. Собираем страницу. Без <html>/<head>/<body>: обёртка добавляется при публикации.
const css = readFileSync(path.join(out, "styles.css"), "utf8");
const js = readFileSync(path.join(out, "bundle.js"), "utf8");
const fonts =
  "https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap";

const head = `<title>Fakt</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${fonts}">
<style>
html,body{height:100%}
${css}
</style>`;
const body = `<div id="root"></div>
<script>${js.replace(/<\/script>/g, "<\\/script>")}</script>`;
const html = `${head}\n${body}\n`;
writeFileSync(path.join(out, "index.html"), html, "utf8");

// 4. Локальная версия для проверки в браузере — с полным скелетом документа.
const full = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${head}
</head>
<body>
${body}
</body>
</html>`;
writeFileSync(path.join(out, "local.html"), full, "utf8");

console.log(`preview/index.html: ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`);
