import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
  changePct: real("change_pct"),
  /** Heure de marché (ms) de la variation `changePct` (Yahoo `regularMarketTime`) ; null pour les cryptos. */
  changeAt: integer("change_at"),
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

export const MESSAGE_ROLES = ["user", "assistant", "divider"] as const;
export const MESSAGE_KINDS = ["chat", "alert", "weekly", "monthly", "divider"] as const;
export const MESSAGE_SOURCES = ["app", "telegram", "system"] as const;

/** Fil de discussion unique partagé entre l'app et Telegram. `meta` : JSON texte nullable. */
export const messages = sqliteTable(
  "messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    role: text("role", { enum: MESSAGE_ROLES }).notNull(),
    kind: text("kind", { enum: MESSAGE_KINDS }).notNull(),
    content: text("content").notNull(),
    source: text("source", { enum: MESSAGE_SOURCES }).notNull(),
    readAt: integer("read_at"),
    createdAt: integer("created_at").notNull().$defaultFn(now),
    meta: text("meta"),
  },
  (t) => [index("messages_created_at_idx").on(t.createdAt), index("messages_read_at_idx").on(t.readAt)],
);

/** Réglages clé/valeur ; `value` est du JSON texte. */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull().$defaultFn(now),
});

/** Journal de déduplication des alertes (ex. `budget:12:2026-10:80`). */
export const alertLog = sqliteTable("alert_log", {
  key: text("key").primaryKey(),
  createdAt: integer("created_at").notNull().$defaultFn(now),
  messageId: integer("message_id"),
});

/** Dernière exécution par tâche planifiée (`weekly`/`monthly`/`prices`). */
export const jobRuns = sqliteTable("job_runs", {
  job: text("job").primaryKey(),
  lastPeriod: text("last_period").notNull(),
  lastRunAt: integer("last_run_at").notNull(),
});

/** Journal des modifications faites par Claude (états avant/après en JSON texte), annulables sous 24 h. */
export const aiActions = sqliteTable("ai_actions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  messageId: integer("message_id"),
  tool: text("tool").notNull(),
  summary: text("summary").notNull(),
  changes: text("changes").notNull(),
  createdAt: integer("created_at").notNull().$defaultFn(now),
  undoneAt: integer("undone_at"),
});

/** Actualités Yahoo des positions ; `titleFr` reste vide tant que le titre n'est pas traduit. */
export const news = sqliteTable(
  "news",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    uuid: text("uuid").notNull().unique(),
    title: text("title").notNull(),
    titleFr: text("title_fr"),
    publisher: text("publisher").notNull(),
    link: text("link").notNull(),
    publishedAt: integer("published_at").notNull(),
    fetchedAt: integer("fetched_at").notNull().$defaultFn(now),
  },
  (t) => [index("news_published_at_idx").on(t.publishedAt)],
);

/** Symboles (en majuscules) auxquels une actualité se rattache. */
export const newsSymbols = sqliteTable(
  "news_symbols",
  {
    newsId: integer("news_id")
      .notNull()
      .references(() => news.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
  },
  (t) => [primaryKey({ columns: [t.newsId, t.symbol] })],
);

export const RECURRING_FREQUENCIES = ["monthly", "quarterly", "yearly"] as const;

/** Dépenses récurrentes déclarées (montant en centimes, positif ; c'est une dépense). */
export const recurring = sqliteTable("recurring", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  label: text("label").notNull(),
  amount: integer("amount").notNull(),
  categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),
  accountId: integer("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "restrict" }),
  frequency: text("frequency", { enum: RECURRING_FREQUENCIES }).notNull(),
  /** Mois d'échéance de référence (1-12) ; null pour une récurrente mensuelle. */
  anchorMonth: integer("anchor_month"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull().$defaultFn(now),
});

/** Paiement (ou saut) d'une récurrente pour un mois `YYYY-MM`. Supprimer l'opération supprime la ligne. */
export const recurringPayments = sqliteTable(
  "recurring_payments",
  {
    recurringId: integer("recurring_id")
      .notNull()
      .references(() => recurring.id, { onDelete: "cascade" }),
    period: text("period").notNull(),
    transactionId: integer("transaction_id").references(() => transactions.id, { onDelete: "cascade" }),
    skipped: integer("skipped", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull().$defaultFn(now),
  },
  (t) => [primaryKey({ columns: [t.recurringId, t.period] })],
);
