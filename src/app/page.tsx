import { connection } from "next/server";
import { App } from "@/components/App";
import { listEditions, listFeeds, readResearch, readSettings } from "@/lib/store";

export default async function Page() {
  await connection(); // читаем data/ на каждый запрос, а не на этапе сборки
  const [editions, settings, research] = await Promise.all([listEditions(), readSettings(), readResearch()]);
  // Ленты за последние две недели: сегодняшняя открывается сразу, к прошлым
  // можно вернуться. Без этого вчерашний день терялся целиком — редактор без
  // подшивки это генератор с одноразовым выводом.
  const feeds = await listFeeds(14);
  return (
    <App
      initialEditions={editions}
      initialSettings={settings}
      initialTags={research.tags}
      initialResearch={research.results[0]}
      initialFeeds={feeds}
      preview={false}
    />
  );
}
