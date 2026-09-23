import type { DocKind, DocStore } from "./docs";

/**
 * Документы в Postgres — для работы на бессерверном хостинге.
 *
 * Годится ЛЮБАЯ база Postgres: Supabase, Neon, Vercel Postgres, свой сервер.
 * Привязываться к одному поставщику здесь незачем — это обычная таблица
 * и обычные запросы, и заставлять владельца заводить ещё один сервис
 * только потому, что так написан код, было бы неуважением к его времени.
 *
 * Драйвер выбирается по адресу:
 *   neon.tech  — родной драйвер Neon, он ходит по HTTP;
 *   остальные  — обычное подключение, которое понимает любой Postgres.
 *
 * Почему это важно именно в serverless: функция засыпает между запросами,
 * и обычный пул соединений после пробуждения оказывается с мёртвыми
 * сокетами. У Neon для этого есть HTTP-доступ, у Supabase — отдельный
 * порт пулера (6543), который держит соединения за вас.
 *
 * Таблица одна на все виды. Реляционная схема ничего бы не дала: выпуск
 * и лента — готовые документы, которые читаются и пишутся целиком, а
 * единственный запрос со сложностью — «последние N лент» — решается
 * сортировкой по ключу, потому что ключ у них и есть дата ГГГГ-ММ-ДД.
 */

/** Запрос как шаблонная строка: значения подставляет драйвер, а не склейка. */
type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

async function connect(url: string): Promise<Sql> {
  if (/\.neon\.tech/i.test(url)) {
    const { neon } = await import("@neondatabase/serverless");
    return neon(url) as unknown as Sql;
  }
  const { default: postgres } = await import("postgres");
  return postgres(url, {
    // Пулер Supabase не поддерживает подготовленные запросы; для остальных
    // потеря невелика, а поведение одинаковое везде — это дороже.
    prepare: false,
    // Одно соединение на экземпляр функции: их и так много, а лимит
    // подключений у бесплатных тарифов невелик.
    max: 1,
    idle_timeout: 20,
    connect_timeout: 15,
  }) as unknown as Sql;
}

export function createDbStore(url: string): DocStore {
  let sqlPromise: Promise<Sql> | null = null;
  const getSql = () => (sqlPromise ??= connect(url));

  /*
   * Схема создаётся один раз за время жизни функции. Отдельный шаг миграции
   * ради одной таблицы — лишняя церемония и лишний повод забыть выполнить
   * его перед первым запуском.
   */
  let ready: Promise<void> | null = null;
  const ensure = async () => {
    const sql = await getSql();
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
    await ready;
    return sql;
  };

  return {
    async get(kind: DocKind, key: string) {
      const sql = await ensure();
      const rows = (await sql`select value from docs where kind = ${kind} and key = ${key}`) as {
        value: unknown;
      }[];
      return rows.length ? rows[0].value : null;
    },

    async put(kind: DocKind, key: string, value: unknown) {
      const sql = await ensure();
      await sql`
        insert into docs (kind, key, value, updated_at)
        values (${kind}, ${key}, ${JSON.stringify(value)}::jsonb, now())
        on conflict (kind, key) do update set value = excluded.value, updated_at = now()
      `;
    },

    async keys(kind: DocKind) {
      const sql = await ensure();
      const rows = (await sql`select key from docs where kind = ${kind} order by key desc`) as {
        key: string;
      }[];
      return rows.map((r) => r.key);
    },

    async list(kind: DocKind, limit?: number) {
      const sql = await ensure();
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
