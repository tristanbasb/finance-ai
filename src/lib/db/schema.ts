import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Convention : montants en centimes (entiers), dates « YYYY-MM-DD » (texte),
// horodatages en millisecondes depuis l'epoch (entiers).
// Exception : les prix unitaires (prices.price, holdings.avg_price, holdings.manual_price)
// sont des réels exprimés en centimes (fractions permises, ex. 0.001 pour 0,00001 €).
const now = () => Date.now();

export const ACCOUNT_TYPES = ["checking", "savings", "investment", "crypto", "other"] as const;
export const CATEGORY_KINDS = ["expense", "income"] as const;
export const ASSET_TYPES = ["stock", "etf", "crypto", "manual"] as const;

export const accounts = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  type: text("type", { enum: ACCOUNT_TYPES }).notNull(),
  initialBalance: integer("initial_balance").notNull().default(0),
  color: text("color").notNull().default("#6366f1"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull().$defaultFn(now),
});

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  kind: text("kind", { enum: CATEGORY_KINDS }).notNull(),
  color: text("color").notNull(),
  icon: text("icon").notNull(),
  monthlyBudget: integer("monthly_budget"),
});

export const transactions = sqliteTable(
  "transactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),
    date: text("date").notNull(),
    amount: integer("amount").notNull(),
    label: text("label").notNull(),
    note: text("note"),
    createdAt: integer("created_at").notNull().$defaultFn(now),
  },
  (t) => [
    index("transactions_date_idx").on(t.date),
    index("transactions_account_id_idx").on(t.accountId),
    index("transactions_category_id_idx").on(t.categoryId),
  ],
);

export const goals = sqliteTable("goals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  targetAmount: integer("target_amount").notNull(),
  accountId: integer("account_id").references(() => accounts.id, { onDelete: "set null" }),
  currentAmount: integer("current_amount").notNull().default(0),
  deadline: text("deadline"),
  color: text("color").notNull().default("#10b981"),
});

export const holdings = sqliteTable(
  "holdings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    symbol: text("symbol").notNull(),
    name: text("name").notNull(),
    assetType: text("asset_type", { enum: ASSET_TYPES }).notNull(),
    quantity: real("quantity").notNull(),
    avgPrice: real("avg_price").notNull(),
    manualPrice: real("manual_price"),
    currency: text("currency").notNull().default("EUR"),
  },
  (t) => [index("holdings_account_id_idx").on(t.accountId)],
);

export const prices = sqliteTable("prices", {
  symbol: text("symbol").primaryKey(),
  price: real("price").notNull(),
  currency: text("currency").notNull(),
  fetchedAt: integer("fetched_at").notNull(),
});

export const snapshots = sqliteTable("snapshots", {
  date: text("date").primaryKey(),
  netWorth: integer("net_worth").notNull(),
  cash: integer("cash").notNull(),
  investments: integer("investments").notNull(),
});

export const aiCache = sqliteTable("ai_cache", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  createdAt: integer("created_at").notNull().$defaultFn(now),
});
