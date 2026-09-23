import { promises as fs } from "node:fs";
import path from "node:path";
import type { DocKind, DocStore } from "./docs";

/**
 * Документы файлами в data/ — то, как проект работал с самого начала.
 *
 * Раскладка на диске сохранена в точности: выпуски по-прежнему лежат в
 * data/editions/ГГГГ-ММ-ДД.json, ленты в data/feeds/, настройки и
 * исследования отдельными файлами в корне. Их можно открыть редактором,
 * а git ведёт их историю вместе с кодом — ради этого всё и затевалось.
 *
 * Этот способ остаётся основным для работы на своём компьютере: базу ради
 * одного пользователя поднимать незачем.
 */

const DATA_DIR = path.join(process.cwd(), "data");

/** Куда кладётся документ каждого вида. */
function pathOf(kind: DocKind, key: string): string {
  switch (kind) {
    case "edition":
      return path.join(DATA_DIR, "editions", `${key}.json`);
    case "feed":
      return path.join(DATA_DIR, "feeds", `${key}.json`);
    default:
      // Единственные в своём роде лежат в корне под именем вида.
      return path.join(DATA_DIR, `${kind}.json`);
  }
}

function dirOf(kind: DocKind): string {
  return kind === "edition"
    ? path.join(DATA_DIR, "editions")
    : kind === "feed"
      ? path.join(DATA_DIR, "feeds")
      : DATA_DIR;
}

async function ensureDir(kind: DocKind): Promise<void> {
  await fs.mkdir(dirOf(kind), { recursive: true });
}

export function createFileStore(): DocStore {
  return {
    async get(kind, key) {
      try {
        return JSON.parse(await fs.readFile(pathOf(kind, key), "utf8"));
      } catch {
        // Файла нет или он испорчен — для вызывающего это одно и то же.
        return null;
      }
    },

    async put(kind, key, value) {
      await ensureDir(kind);
      // Отступ в два пробела: файлы читают и правят руками.
      await fs.writeFile(pathOf(kind, key), JSON.stringify(value, null, 2), "utf8");
    },

    async keys(kind) {
      if (kind !== "edition" && kind !== "feed") return [kind];
      try {
        const files = await fs.readdir(dirOf(kind));
        return files
          .filter((f) => f.endsWith(".json"))
          .map((f) => f.slice(0, -".json".length))
          .sort()
          .reverse();
      } catch {
        return [];
      }
    },

    async list(kind, limit) {
      const keys = await this.keys(kind);
      const wanted = typeof limit === "number" ? keys.slice(0, limit) : keys;
      const out: unknown[] = [];
      for (const key of wanted) {
        const doc = await this.get(kind, key);
        if (doc !== null) out.push(doc);
      }
      return out;
    },
  };
}
