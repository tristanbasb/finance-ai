import { describe, expect, it, vi } from "vitest";
import { createDb } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { seedDefaults } from "@/lib/db/seed";
import { accounts, holdings, news, newsSymbols } from "@/lib/db/schema";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", async (orig) => ({ ...(await orig<typeof import("@/lib/db")>()), getDb: () => state.db }));

import { GET } from "@/app/api/news/route";

type Item = { id: number; title: string; publishedAt: number; symbols: string[] };

function setup() {
  const db = createDb(":memory:");
  runMigrations(db);
  seedDefaults(db);
  state.db = db;
  const acc = db.select().from(accounts).get()!;
  for (const [symbol, assetType] of [
    ["AAPL", "stock"],
    ["BTC", "crypto"],
  ] as const) {
    db.insert(holdings).values({ accountId: acc.id, symbol, name: symbol, assetType, quantity: 1, avgPrice: 1 }).run();
  }
  for (let i = 1; i <= 12; i++) {
    const row = db
      .insert(news)
      .values({ uuid: `u${i}`, title: `T${i}`, publisher: "P", link: `https://example.com/${i}`, publishedAt: i * 1000, fetchedAt: 1 })
      .returning()
      .get();
    db.insert(newsSymbols).values({ newsId: row.id, symbol: i % 3 === 0 ? "BTC" : "AAPL" }).run();
  }
}

async function get(qs: string): Promise<{ status: number; items: Item[] }> {
  const res = await GET(new Request(`http://x/api/news${qs}`));
  const body = (await res.json()) as { items?: Item[] };
  return { status: res.status, items: body.items ?? [] };
}

describe("GET /api/news", () => {
  it("renvoie 10 articles par défaut, les plus récents d'abord", async () => {
    setup();
    const { status, items } = await get("");
    expect(status).toBe(200);
    expect(items).toHaveLength(10);
    expect(items[0]).toMatchObject({ title: "T12", symbols: ["BTC"] });
  });

  it("filtre par symbole et pagine", async () => {
    setup();
    const { items } = await get("?symbol=btc&limit=2");
    expect(items.map((i) => i.title)).toEqual(["T12", "T9"]);
    const last = items[1];
    const more = await get(`?symbol=BTC&limit=10&before=${last.publishedAt}&beforeId=${last.id}`);
    expect(more.items.map((i) => i.title)).toEqual(["T6", "T3"]);
  });

  it("refuse les paramètres invalides (400)", async () => {
    setup();
    for (const qs of ["?limit=0", "?limit=51", "?before=-1", "?before=abc", `?symbol=${"X".repeat(33)}`, "?beforeId=0"]) {
      expect((await get(qs)).status, qs).toBe(400);
    }
  });
});
