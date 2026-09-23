/**
 * Точка входа статического превью: та же React-обвязка, что и в Next-приложении,
 * но без сервера — данные вшиты на этапе сборки (scripts/build-preview.mjs).
 */
import { createRoot } from "react-dom/client";
import { App } from "@/components/App";
import { DEFAULT_SETTINGS } from "@/lib/brief";
import type { Edition } from "@/lib/schema";
import seed from "../../data/editions/2026-09-18.json";

// JSON уже проверен схемой при сохранении; в превью Zod не тянем ради размера бандла.
const edition = seed as Edition;
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App initialEditions={[edition]} initialSettings={DEFAULT_SETTINGS} preview />);
}
