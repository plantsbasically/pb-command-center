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

async function ensureSchema() {
  if (schemaReady) return
  const sql = getSql()
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
  schemaReady = true
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
