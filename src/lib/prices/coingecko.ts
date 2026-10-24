import type { PriceFetcher } from "./index";

const BASE = "https://api.coingecko.com/api/v3";
const TIMEOUT_MS = 8000;

/** Symbole (minuscule) → identifiant CoinGecko, mémorisé pour la durée du processus. */
const idCache = new Map<string, string>();

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  return res.json();
}

async function resolveId(symbol: string): Promise<string | null> {
  const key = symbol.toLowerCase();
  const cached = idCache.get(key);
  if (cached) return cached;
  const data = (await getJson(`${BASE}/search?query=${encodeURIComponent(symbol)}`)) as {
    coins?: { id: string; symbol: string }[];
  };
  const coins = data.coins ?? [];
  // Un identifiant CoinGecko exact (ex. « bitcoin ») prime ; sinon le premier symbole
  // identique, les résultats étant classés par capitalisation.
  const match = coins.find((c) => c.id === key) ?? coins.find((c) => c.symbol.toLowerCase() === key);
  if (!match) return null;
  idCache.set(key, match.id);
  return match.id;
}

/** Cours crypto en EUR via l'API publique CoinGecko (sans clé). */
export const coingeckoFetcher: PriceFetcher = async (symbols) => {
  const out = new Map<string, { price: number; currency: string }>();
  const idToSymbols = new Map<string, string[]>();
  for (const symbol of symbols) {
    const id = await resolveId(symbol);
    if (!id) continue;
    idToSymbols.set(id, [...(idToSymbols.get(id) ?? []), symbol]);
  }
  if (idToSymbols.size === 0) return out;
  const ids = [...idToSymbols.keys()].join(",");
  const data = (await getJson(
    `${BASE}/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=eur`,
  )) as Record<string, { eur?: number } | undefined>;
  for (const [id, syms] of idToSymbols) {
    const eur = data[id]?.eur;
    if (typeof eur !== "number") continue;
    for (const s of syms) out.set(s, { price: eur, currency: "EUR" });
  }
  return out;
};
