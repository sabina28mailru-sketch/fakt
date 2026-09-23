import { neon } from "@neondatabase/serverless";
import type { DocKind, DocStore } from "./docs";

/**
 * Документы в Postgres — для работы на бессерверном хостинге.
 *
 * Драйвер обращается к базе по HTTP, а не держит соединение. Это принципиально
 * для serverless: обычный пул соединений там не переживает засыпание функции,
 * и первое же обращение после паузы падает.
 *
 * Запросы написаны шаблонными строками — это не украшение: драйвер сам
 * подставляет значения параметрами, и склеить запрос из чужой строки
 * случайно не получится.
 *
 * Таблица одна на все виды. Реляционная схема здесь ничего не дала бы:
 * выпуск и лента — готовые документы, которые читаются и пишутся целиком,
 * а единственный запрос со сложностью — «последние N лент», и он решается
 * сортировкой по ключу: ключ у них и есть дата вида ГГГГ-ММ-ДД.
 */

export function createDbStore(url: string): DocStore {
  const sql = neon(url);

  /*
   * Схема создаётся один раз за время жизни функции. Отдельный шаг миграции
   * ради одной таблицы — лишняя церемония и лишний повод забыть выполнить
   * его перед первым запуском.
   */
  let ready: Promise<void> | null = null;
  const ensure = () => {
    if (!ready) {
      ready = (async () => {
        await sql`
          create table if not exists docs (
            kind text not null,
            key text not null,
            value jsonb not null,
            updated_at timestamptz not null default now(),
            primary key (kind, key)
          )
        `;
        await sql`create index if not exists docs_kind_key on docs (kind, key desc)`;
      })().catch((e) => {
        // Неудачную попытку не запоминаем: следующий вызов должен попробовать снова.
        ready = null;
        throw e;
      });
    }
    return ready;
  };

  return {
    async get(kind: DocKind, key: string) {
      await ensure();
      const rows = (await sql`select value from docs where kind = ${kind} and key = ${key}`) as {
        value: unknown;
      }[];
      return rows.length ? rows[0].value : null;
    },

    async put(kind: DocKind, key: string, value: unknown) {
      await ensure();
      await sql`
        insert into docs (kind, key, value, updated_at)
        values (${kind}, ${key}, ${JSON.stringify(value)}::jsonb, now())
        on conflict (kind, key) do update set value = excluded.value, updated_at = now()
      `;
    },

    async keys(kind: DocKind) {
      await ensure();
      const rows = (await sql`select key from docs where kind = ${kind} order by key desc`) as {
        key: string;
      }[];
      return rows.map((r) => r.key);
    },

    async list(kind: DocKind, limit?: number) {
      await ensure();
      // Потолок на случай, когда предел не задан: выгружать всю историю
      // одним запросом незачем, а забыть его передать — легко.
      const max = typeof limit === "number" ? limit : 500;
      const rows = (await sql`
        select value from docs where kind = ${kind} order by key desc limit ${max}
      `) as { value: unknown }[];
      return rows.map((r) => r.value);
    },
  };
}
