import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { holdings, prices } from "@/lib/db/schema";
import { NotFoundError } from "@/lib/api";
import { holdingPnl } from "@/lib/finance";
import type { HoldingInput } from "@/lib/validation";

export type Holding = typeof holdings.$inferSelect;
export type NewHolding = typeof holdings.$inferInsert;

export type PriceSource = "manual" | "cache" | "cost";

export type HoldingWithValue = Holding & {
  /** Prix unitaire retenu (réel, en centimes). */
  price: number;
  priceSource: PriceSource;
  /** Valeur, coût et plus-value en centimes entiers ; `pnlPct` en fraction. */
  value: number;
  cost: number;
  pnl: number;
  pnlPct: number;
};

/**
 * Prix unitaire retenu pour valoriser une position : prix manuel (actif « manual »),
 * sinon dernier cours en cache, sinon prix de revient moyen.
 */
export function unitPrice(
  h: { assetType: string; manualPrice: number | null; avgPrice: number },
  cached: number | null,
): { price: number; source: PriceSource } {
  if (h.assetType === "manual" && h.manualPrice !== null) {
    return { price: h.manualPrice, source: "manual" };
  }
  if (cached !== null) return { price: cached, source: "cache" };
  return { price: h.avgPrice, source: "cost" };
}

export function listHoldingsWithValues(db: Db): HoldingWithValue[] {
  const cache = new Map(db.select().from(prices).all().map((p) => [p.symbol, p.price]));
  return db
    .select()
    .from(holdings)
    .orderBy(holdings.id)
    .all()
    .map((h) => {
      const { price, source } = unitPrice(h, cache.get(h.symbol) ?? null);
      return {
        ...h,
        price,
        priceSource: source,
        ...holdingPnl({ quantity: h.quantity, avgPrice: h.avgPrice, price }),
      };
    });
}

export function createHolding(db: Db, input: HoldingInput): Holding {
  return db.insert(holdings).values(input).returning().get();
}

export function updateHolding(db: Db, id: number, patch: Partial<HoldingInput>): Holding {
  const current = db.select().from(holdings).where(eq(holdings.id, id)).get();
  if (!current) throw new NotFoundError();
  if (Object.keys(patch).length === 0) return current;
  return db.update(holdings).set(patch).where(eq(holdings.id, id)).returning().get()!;
}

export function deleteHolding(db: Db, id: number): void {
  const deleted = db.delete(holdings).where(eq(holdings.id, id)).returning({ id: holdings.id }).all();
  if (deleted.length === 0) throw new NotFoundError();
}
