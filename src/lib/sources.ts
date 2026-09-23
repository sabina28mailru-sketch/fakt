/**
 * Домены, по которым разрешён поиск. Поиск идёт строго по ним (режим restrict):
 * без этого Tavily при слабом совпадении молча подмешивает Instagram и SEO-блоги,
 * а весь смысл брифа — в дисциплине источников.
 *
 * Списки соответствуют блокам брифа в brief.ts (sourcesWorld / sourcesKz / sourcesCis / science).
 */
export const DEFAULT_SOURCE_DOMAINS = {
  world: [
    "hbr.org",
    "fastcompany.com",
    "forbes.com",
    "inc.com",
    "entrepreneur.com",
    "socialmediatoday.com",
    "digiday.com",
    "news.linkedin.com",
    "sproutsocial.com",
    "hubspot.com",
    "hootsuite.com",
    "edelman.com",
    "datareportal.com",
    "pewresearch.org",
    "gartner.com",
    "mckinsey.com",
    "nielsen.com",
    "goldmansachs.com",
    "seths.blog",
    "businessesgrow.com",
    "justinwelsh.me",
    "dorieclark.com",
  ],
  kz: [
    "kapital.kz",
    "forbes.kz",
    "kz.kursiv.media",
    "digitalbusiness.kz",
    "inbusiness.kz",
    "the-tech.kz",
    "tribune.kz",
    "tengrinews.kz",
    "aaca.com.kz",
    "napoleoncat.com",
    "ranking.kz",
    "stat.gov.kz",
  ],
  cis: [
    "sostav.ru",
    "cossa.ru",
    "vc.ru",
    "adindex.ru",
    "br-analytics.ru",
    "mediascope.net",
    "iom.anketolog.ru",
    "rbc.ru",
    "kommersant.ru",
    "vedomosti.ru",
  ],
  science: [
    "psycnet.apa.org",
    "journals.sagepub.com",
    "science.org",
    "nature.com",
    "pubmed.ncbi.nlm.nih.gov",
    "researchgate.net",
    "ssrn.com",
    "edelman.com",
    "pewresearch.org",
  ],
} as const;

/** Блок источников: к какому списку доменов привязан поисковый запрос. */
export type SourceBucket = keyof typeof DEFAULT_SOURCE_DOMAINS;

export const BUCKETS: SourceBucket[] = ["world", "kz", "cis", "science"];
