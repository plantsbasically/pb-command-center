import postgres from "postgres"

// Singleton connection — reused across requests on Railway's long-running server
const globalForSql = globalThis as unknown as { _sql?: ReturnType<typeof postgres> }

function getSql() {
  if (!globalForSql._sql) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error("DATABASE_URL is not set — add the Railway Postgres plugin")
    globalForSql._sql = postgres(url, { ssl: "prefer", max: 5 })
  }
  return globalForSql._sql
}

let schemaReady = false
/** In-process mutex so concurrent first requests share one migration. */
let schemaPromise: Promise<void> | null = null

/** Advisory lock key for schema migrations (arbitrary stable int4). */
const SCHEMA_ADVISORY_LOCK = 872_014_001

async function ensureSchema() {
  if (schemaReady) return
  if (!schemaPromise) {
    schemaPromise = runSchemaMigration()
  }
  await schemaPromise
}

async function runSchemaMigration() {
  const sql = getSql()
  // Serialize across processes/connections — avoids concurrent CREATE races on cold start.
  await sql`SELECT pg_advisory_lock(${SCHEMA_ADVISORY_LOCK})`
  try {
    if (schemaReady) return
    await sql`
      CREATE TABLE IF NOT EXISTS cogs_variants (
        id                  SERIAL PRIMARY KEY,
        variant_key         TEXT UNIQUE NOT NULL,
        variant_name        TEXT NOT NULL,
        shopify_variant_id  TEXT NOT NULL DEFAULT '',
        line_items          JSONB NOT NULL DEFAULT '[]',
        total_cost          NUMERIC(10,4) NOT NULL DEFAULT 0,
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `
    // Idempotent migration: add shopify_product_id if the table was created before this column existed
    await sql`
      ALTER TABLE cogs_variants
      ADD COLUMN IF NOT EXISTS shopify_product_id TEXT NOT NULL DEFAULT ''
    `
    await sql`
      CREATE TABLE IF NOT EXISTS fixed_costs (
        id           SERIAL PRIMARY KEY,
        name         TEXT UNIQUE NOT NULL,
        monthly_cost NUMERIC(10,4) NOT NULL DEFAULT 0,
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `
    await sql`
      CREATE TABLE IF NOT EXISTS fulfillment_invoices (
        id           SERIAL PRIMARY KEY,
        label        TEXT NOT NULL DEFAULT '',
        period_start DATE NOT NULL,
        period_end   DATE NOT NULL,
        amount       NUMERIC(10,2) NOT NULL DEFAULT 0,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `
    await sql`
      CREATE TABLE IF NOT EXISTS amazon_fee_invoices (
        id           SERIAL PRIMARY KEY,
        label        TEXT NOT NULL DEFAULT '',
        period_start DATE NOT NULL,
        period_end   DATE NOT NULL,
        amount       NUMERIC(10,2) NOT NULL DEFAULT 0,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `
    // Single-row JSON document for subscription plan → free-gift mappings.
    // Editable later via admin API; seeded from data/gift-mappings.json.
    await sql`
      CREATE TABLE IF NOT EXISTS subscription_gift_mappings (
        id         INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        payload    JSONB NOT NULL DEFAULT '{}',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `
    // Loop analytics ingest (external assistant POSTs daily MCP snapshots).
    await sql`
      CREATE TABLE IF NOT EXISTS loop_daily_metrics (
        date                  DATE PRIMARY KEY,
        new_subscribers       INT NOT NULL DEFAULT 0,
        reactivated           INT NOT NULL DEFAULT 0,
        resumed               INT NOT NULL DEFAULT 0,
        churned               INT NULL,
        active_subscribers    INT NULL,
        active_subscriptions  INT NULL,
        mrr                   NUMERIC NULL,
        source                TEXT,
        raw                   JSONB,
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `
    await sql`
      CREATE TABLE IF NOT EXISTS loop_cohort_retention (
        cohort_start        DATE NOT NULL,
        cohort_granularity  TEXT NOT NULL CHECK (cohort_granularity IN ('day', 'week', 'month')),
        cohort_size         INT NOT NULL DEFAULT 0,
        metric              TEXT NOT NULL,
        value_pct           NUMERIC NOT NULL,
        ltv                 NUMERIC NULL,
        snapshot_date       DATE NOT NULL,
        raw                 JSONB,
        PRIMARY KEY (cohort_start, cohort_granularity, metric, snapshot_date)
      )
    `
    await sql`
      CREATE TABLE IF NOT EXISTS loop_ltv_snapshot (
        snapshot_date           DATE NOT NULL,
        segment                 TEXT NOT NULL,
        customers               INT NOT NULL DEFAULT 0,
        revenue_per_customer    NUMERIC NOT NULL DEFAULT 0,
        raw                     JSONB,
        PRIMARY KEY (snapshot_date, segment)
      )
    `
    schemaReady = true
  } finally {
    await sql`SELECT pg_advisory_unlock(${SCHEMA_ADVISORY_LOCK})`
  }
}

/** Shared DB handle after schema is ready — used by loop-metrics ingest helpers. */
export async function getDb() {
  const sql = getSql()
  await ensureSchema()
  return sql
}

export interface COGSVariantRow {
  variantKey: string
  variantName: string
  shopifyVariantId: string
  shopifyProductId: string  // Shopify product ID — required for TW COGS enrichment API
  lineItems: { name: string; cost: number; quantity: number }[]
  totalCost: number
}

export interface FixedCostRow {
  name: string
  monthlyCost: number
}

export async function getCogsVariants(): Promise<COGSVariantRow[]> {
  const sql = getSql()
  await ensureSchema()
  const rows = await sql`SELECT * FROM cogs_variants ORDER BY id`

  // Seed from bundled JSON on first run (empty table)
  if (rows.length === 0) {
    const { readJSON } = await import("./filestore")
    const seed = readJSON<{ variants: COGSVariantRow[] }>("cogs.json")
    if (seed?.variants?.length) {
      await saveCogsVariants(seed.variants)
      return seed.variants
    }
  }

  return rows.map((r) => ({
    variantKey: r.variant_key as string,
    variantName: r.variant_name as string,
    shopifyVariantId: r.shopify_variant_id as string,
    shopifyProductId: (r.shopify_product_id as string) || "",
    lineItems: r.line_items as COGSVariantRow["lineItems"],
    totalCost: Number(r.total_cost),
  }))
}

export async function saveCogsVariants(variants: COGSVariantRow[]): Promise<void> {
  const sql = getSql()
  await ensureSchema()
  await sql`DELETE FROM cogs_variants`
  for (const v of variants) {
    await sql`
      INSERT INTO cogs_variants (variant_key, variant_name, shopify_variant_id, shopify_product_id, line_items, total_cost, updated_at)
      VALUES (
        ${v.variantKey},
        ${v.variantName},
        ${v.shopifyVariantId || ""},
        ${v.shopifyProductId || ""},
        ${sql.json(v.lineItems)},
        ${v.totalCost},
        NOW()
      )
    `
  }
}

export async function getFixedCosts(): Promise<FixedCostRow[]> {
  const sql = getSql()
  await ensureSchema()
  const rows = await sql`SELECT * FROM fixed_costs ORDER BY id`

  // Seed from bundled JSON on first run (empty table)
  if (rows.length === 0) {
    const { readJSON } = await import("./filestore")
    const seed = readJSON<{ lineItems: FixedCostRow[] }>("fixedcosts.json")
    if (seed?.lineItems?.length) {
      await saveFixedCosts(seed.lineItems)
      return seed.lineItems
    }
  }

  return rows.map((r) => ({
    name: r.name as string,
    monthlyCost: Number(r.monthly_cost),
  }))
}

export async function saveFixedCosts(lineItems: FixedCostRow[]): Promise<void> {
  const sql = getSql()
  await ensureSchema()
  await sql`DELETE FROM fixed_costs`
  for (const item of lineItems) {
    await sql`
      INSERT INTO fixed_costs (name, monthly_cost, updated_at)
      VALUES (${item.name}, ${item.monthlyCost}, NOW())
    `
  }
}

export interface FulfillmentInvoiceRow {
  id: number
  label: string
  periodStart: string  // YYYY-MM-DD
  periodEnd: string    // YYYY-MM-DD
  amount: number
}

export async function getFulfillmentInvoices(): Promise<FulfillmentInvoiceRow[]> {
  const sql = getSql()
  await ensureSchema()
  const rows = await sql`SELECT * FROM fulfillment_invoices ORDER BY period_start DESC`
  return rows.map((r) => ({
    id: Number(r.id),
    label: r.label as string,
    periodStart: (r.period_start as Date).toISOString().split("T")[0],
    periodEnd: (r.period_end as Date).toISOString().split("T")[0],
    amount: Number(r.amount),
  }))
}

export async function addFulfillmentInvoice(invoice: Omit<FulfillmentInvoiceRow, "id">): Promise<FulfillmentInvoiceRow> {
  const sql = getSql()
  await ensureSchema()
  const rows = await sql`
    INSERT INTO fulfillment_invoices (label, period_start, period_end, amount)
    VALUES (${invoice.label}, ${invoice.periodStart}, ${invoice.periodEnd}, ${invoice.amount})
    RETURNING *
  `
  const r = rows[0]
  return {
    id: Number(r.id),
    label: r.label as string,
    periodStart: (r.period_start as Date).toISOString().split("T")[0],
    periodEnd: (r.period_end as Date).toISOString().split("T")[0],
    amount: Number(r.amount),
  }
}

export async function deleteFulfillmentInvoice(id: number): Promise<void> {
  const sql = getSql()
  await ensureSchema()
  await sql`DELETE FROM fulfillment_invoices WHERE id = ${id}`
}

export interface AmazonFeeInvoiceRow {
  id: number
  label: string
  periodStart: string  // YYYY-MM-DD
  periodEnd: string    // YYYY-MM-DD
  amount: number
}

export async function getAmazonFeeInvoices(): Promise<AmazonFeeInvoiceRow[]> {
  const sql = getSql()
  await ensureSchema()
  const rows = await sql`SELECT * FROM amazon_fee_invoices ORDER BY period_start DESC`
  return rows.map((r) => ({
    id: Number(r.id),
    label: r.label as string,
    periodStart: (r.period_start as Date).toISOString().split("T")[0],
    periodEnd: (r.period_end as Date).toISOString().split("T")[0],
    amount: Number(r.amount),
  }))
}

export async function addAmazonFeeInvoice(invoice: Omit<AmazonFeeInvoiceRow, "id">): Promise<AmazonFeeInvoiceRow> {
  const sql = getSql()
  await ensureSchema()
  const rows = await sql`
    INSERT INTO amazon_fee_invoices (label, period_start, period_end, amount)
    VALUES (${invoice.label}, ${invoice.periodStart}, ${invoice.periodEnd}, ${invoice.amount})
    RETURNING *
  `
  const r = rows[0]
  return {
    id: Number(r.id),
    label: r.label as string,
    periodStart: (r.period_start as Date).toISOString().split("T")[0],
    periodEnd: (r.period_end as Date).toISOString().split("T")[0],
    amount: Number(r.amount),
  }
}

export async function deleteAmazonFeeInvoice(id: number): Promise<void> {
  const sql = getSql()
  await ensureSchema()
  await sql`DELETE FROM amazon_fee_invoices WHERE id = ${id}`
}

export async function getGiftMappings(): Promise<import("./gift-mapping").GiftMappingsData> {
  const sql = getSql()
  await ensureSchema()
  const rows = await sql`SELECT payload FROM subscription_gift_mappings WHERE id = 1`
  if (rows.length === 0) {
    const { readJSON } = await import("./filestore")
    const seed = readJSON<import("./gift-mapping").GiftMappingsData & { _meta?: unknown }>("gift-mappings.json")
    const payload = {
      giftSkus: seed?.giftSkus || [],
      plans: seed?.plans || [],
    }
    await saveGiftMappings(payload)
    return payload
  }
  const payload = rows[0].payload as import("./gift-mapping").GiftMappingsData
  return {
    giftSkus: payload.giftSkus || [],
    plans: payload.plans || [],
  }
}

export async function saveGiftMappings(
  data: import("./gift-mapping").GiftMappingsData
): Promise<import("./gift-mapping").GiftMappingsData> {
  const sql = getSql()
  await ensureSchema()
  const payload = { giftSkus: data.giftSkus || [], plans: data.plans || [] }
  // postgres JSONValue is stricter than our domain types — serialize via JSON round-trip
  const jsonPayload = JSON.parse(JSON.stringify(payload)) as Parameters<typeof sql.json>[0]
  await sql`
    INSERT INTO subscription_gift_mappings (id, payload, updated_at)
    VALUES (1, ${sql.json(jsonPayload)}, NOW())
    ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
  `
  return payload
}
