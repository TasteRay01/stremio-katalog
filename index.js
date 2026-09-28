const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");

const KEY = process.env.TMDB_API_KEY;
if (!KEY) {
  console.error("Mungon TMDB_API_KEY (çelësi nga themoviedb.org).");
  process.exit(1);
}

const API = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p/w342";
const TTL = 6 * 60 * 60 * 1000;

const LATAM = "MX|AR|BR|CO|CL|PE|UY|VE|EC|BO|PY|CU|CR|PA|DO|GT|PR|HN|NI|SV";
const G = { action: 28, comedy: 35, thriller: 53, crime: 80, horror: 27, drama: 18 };

const KW = {
  heist: { queries: ["heist"], re: /heist/ },
  bl: { queries: ["boys love", "boys' love"], re: /boys.{0,3}love/ },
  lgbt: {
    queries: ["lgbt", "gay", "lesbian", "queer", "transgender", "homosexuality"],
    re: /lgbt|gay|lesbian|queer|transgender|homosexual/,
  },
  gay: {
    queries: ["gay", "gay theme", "gay interest", "male homosexuality", "homosexuality", "gay relationship", "gay romance"],
    re: /gay|homosexual/,
    not: /lesbian|female/,
  },
};

const CATALOGS = [
  { id: "kr-film-best", type: "movie", name: "🇰🇷 Filma Koreane · Më të mirat", q: { with_origin_country: "KR" }, votes: 300 },
  { id: "kr-film-action", type: "movie", name: "🇰🇷 Filma Koreane · Aksion", q: { with_origin_country: "KR", with_genres: G.action }, votes: 100 },
  { id: "kr-film-actioncomedy", type: "movie", name: "🇰🇷 Filma Koreane · Aksion Komedi", q: { with_origin_country: "KR", with_genres: `${G.action},${G.comedy}` }, votes: 40 },
  { id: "kr-film-thriller", type: "movie", name: "🇰🇷 Filma Koreane · Thriller", q: { with_origin_country: "KR", with_genres: G.thriller }, votes: 100 },
  { id: "kr-film-crime", type: "movie", name: "🇰🇷 Filma Koreane · Crime", q: { with_origin_country: "KR", with_genres: G.crime }, votes: 100 },
  { id: "kr-film-heist", type: "movie", name: "🇰🇷 Filma Koreane · Heist", q: { with_origin_country: "KR" }, kw: "heist", votes: 15 },
  { id: "kr-film-horror", type: "movie", name: "🇰🇷 Filma Koreane · Horror", q: { with_origin_country: "KR", with_genres: G.horror }, votes: 80 },
  { id: "kr-film-drama", type: "movie", name: "🇰🇷 Filma Koreane · Dramë", q: { with_origin_country: "KR", with_genres: G.drama }, votes: 150 },

  { id: "kr-series-best", type: "series", name: "🇰🇷 Seriale Koreane · Më të mirat", q: { with_origin_country: "KR" }, votes: 200 },

  { id: "th-bl", type: "series", name: "🇹🇭 Thai BL · Cilësore", q: { with_origin_country: "TH" }, kw: "bl", votes: 15, minRating: 7.5 },
  { id: "kr-bl", type: "series", name: "🇰🇷 Korean BL · Cilësore", q: { with_origin_country: "KR" }, kw: "bl", votes: 10, minRating: 7 },

  { id: "latam-film-best", type: "movie", name: "🌎 Amerika Latine · Filmat më të mirë", q: { with_origin_country: LATAM }, votes: 300 },
  { id: "latam-series-best", type: "series", name: "🌎 Amerika Latine · Serialet më të mira", q: { with_origin_country: LATAM }, votes: 100 },
  { id: "latam-queer", type: "movie", name: "🏳️‍🌈 Amerika Latine · Queer Movies", q: { with_origin_country: LATAM }, kw: "gay", votes: 8, minRating: 6 },

  { id: "queer-world", type: "movie", name: "🏳️‍🌈 Gay / Queer Cinema · Më të mirat", q: {}, kw: "lgbt", votes: 200, minRating: 6.5 },
];

const manifest = {
  id: "org.im.katalogu.auto",
  version: "1.0.0",
  name: "Katalogu Im",
  description: "Katalogë automatikë: kinema koreane, BL, Amerika Latine dhe queer cinema",
  resources: ["catalog"],
  types: ["movie", "series"],
  idPrefixes: ["tt"],
  catalogs: CATALOGS.map((c) => ({
    type: c.type,
    id: c.id,
    name: c.name,
    extra: [{ name: "skip", isRequired: false }],
  })),
};

const cache = new Map();
function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.val;
  const val = fn().catch((e) => {
    cache.delete(key);
    throw e;
  });
  cache.set(key, { val, exp: Date.now() + TTL });
  return val;
}

async function tmdb(path, params = {}) {
  const url = new URL(API + path);
  url.searchParams.set("api_key", KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`TMDB ${r.status} ${path}`);
  return r.json();
}

function resolveKeywords(name) {
  return cached(`kw:${name}`, async () => {
    const { queries, re, not } = KW[name];
    const ids = new Set();
    for (const query of queries) {
      const data = await tmdb("/search/keyword", { query });
      for (const k of data.results || []) {
        const n = k.name.toLowerCase();
        if (re.test(n) && !(not && not.test(n))) ids.add(k.id);
      }
    }
    return [...ids].join("|");
  });
}

function imdbId(type, id) {
  return cached(`imdb:${type}:${id}`, async () => {
    const d = await tmdb(`/${type === "movie" ? "movie" : "tv"}/${id}/external_ids`);
    return d.imdb_id || null;
  });
}

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async ({ type, id, extra }) => {
  const c = CATALOGS.find((x) => x.id === id && x.type === type);
  if (!c) return { metas: [] };

  const page = Math.floor(Number((extra && extra.skip) || 0) / 20) + 1;

  try {
    const params = {
      ...c.q,
      sort_by: "vote_average.desc",
      "vote_count.gte": c.votes,
      include_adult: "false",
      language: "en-US",
      page,
    };
    if (c.minRating) params["vote_average.gte"] = c.minRating;
    if (c.kw) {
      const ids = await resolveKeywords(c.kw);
      if (!ids) return { metas: [] };
      params.with_keywords = ids;
    }

    const data = await cached(`cat:${id}:${page}`, () =>
      tmdb(`/discover/${type === "movie" ? "movie" : "tv"}`, params)
    );

    const metas = (
      await Promise.all(
        (data.results || []).map(async (it) => {
          const imdb = await imdbId(type, it.id).catch(() => null);
          if (!imdb) return null;
          return {
            id: imdb,
            type,
            name: it.title || it.name,
            poster: it.poster_path ? IMG + it.poster_path : undefined,
            releaseInfo: (it.release_date || it.first_air_date || "").slice(0, 4),
            description: it.overview,
          };
        })
      )
    ).filter(Boolean);

    return { metas, cacheMaxAge: 6 * 60 * 60 };
  } catch (e) {
    console.error(e.message);
    return { metas: [] };
  }
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });
console.log("Addon-i po punon.");
