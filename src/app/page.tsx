import { connection } from "next/server";
import { App } from "@/components/App";
import { listEditions, readFeed, readResearch, readSettings } from "@/lib/store";
import { todayIso } from "@/lib/utils";

export default async function Page() {
  await connection(); // читаем data/ на каждый запрос, а не на этапе сборки
  const [editions, settings, research] = await Promise.all([listEditions(), readSettings(), readResearch()]);
  // Лента читается по сегодняшней дате пользователя: вчерашнюю показывать
  // как сегодняшнюю нельзя, раздел про «что снимать сегодня».
  const feed = await readFeed(todayIso(settings.userLocation.timezone));
  return (
    <App
      initialEditions={editions}
      initialSettings={settings}
      initialTags={research.tags}
      initialResearch={research.results[0]}
      initialFeed={feed ?? undefined}
      preview={false}
    />
  );
}
