/**
 * ShipFusion billing client — primary source for daily 3PL fulfillment cost.
 *
 * Base: https://api.shipfusion.com/v1
 * Auth: Prefer `X-SHIPFUSION-TOKEN` (confirmed in ShipFusion OpenAPI securitySchemes).
 *       Also try `Authorization: Bearer` if token-header auth fails (getting-started
 *       docs mention Bearer tokens as the newer portal credential style).
 * Env:  SHIPFUSION_API_KEY (preferred) or SHIPFUSION_API_TOKEN.
 *
 * Endpoints used:
 *   GET /invoices?invoicePeriodStart=YYYYMM&invoicePeriodEnd=YYYYMM
 *   GET /invoices/{id}?type=shipment  (paginated transactions)
 *
 * Charge classification from per-shipment transaction fields:
 *   services  → pickPack
 *   shipping  → shipping
 *   packaging → packaging
 *   insurance → insurance
 *   tax + any other residual on the line → other
 *
 * Daily grouping uses billingTimestamp → America/Los_Angeles calendar date when
 * present; otherwise parses billingDate (YYYYMMDD) as that calendar day.
 *
 * Caching: closed invoice months use a long TTL; the current calendar month ~1h.
 * Never throws — returns empty daily costs when the key is missing or the API fails.
 */

const BASE_URL = "https://api.shipfusion.com/v1"
const LA_TZ = "America/Los_Angeles"

const CLOSED_MONTH_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const CURRENT_MONTH_TTL_MS = 60 * 60 * 1000 // 1 hour
const INVOICE_FETCH_CONCURRENCY = 3
const DEFAULT_PER_PAGE = 100

export type FulfillmentChargeCategory =
  | "pickPack"
  | "shipping"
  | "packaging"
  | "insurance"
  | "storage"
  | "other"

export interface FulfillmentBreakdown {
  pickPack: number
  shipping: number
  packaging: number
  insurance: number
  storage: number
  other: number
}

export interface DailyFulfillmentCost {
  date: string // YYYY-MM-DD (America/Los_Angeles)
  total: number
  breakdown: FulfillmentBreakdown
}

export type AuthModeUsed = "x-shipfusion-token" | "bearer" | "none"

export interface ShipFusionFetchResult {
  daily: DailyFulfillmentCost[]
  authMode: AuthModeUsed
  error?: string
  invoiceCount: number
  transactionCount: number
}

type CacheEntry = {
  daily: DailyFulfillmentCost[]
  invoiceCount: number
  transactionCount: number
  authMode: AuthModeUsed
  ts: number
  ttlMs: number
}

const globalCache = globalThis as unknown as {
  _shipfusionCache?: Map<string, CacheEntry>
  _shipfusionAuthMode?: AuthModeUsed
}

function getCache(): Map<string, CacheEntry> {
  if (!globalCache._shipfusionCache) {
    globalCache._shipfusionCache = new Map()
  }
  return globalCache._shipfusionCache
}

function getApiKey(): string {
  return (process.env.SHIPFUSION_API_KEY || process.env.SHIPFUSION_API_TOKEN || "").trim()
}

export function emptyBreakdown(): FulfillmentBreakdown {
  return { pickPack: 0, shipping: 0, packaging: 0, insurance: 0, storage: 0, other: 0 }
}

export function sumBreakdown(b: FulfillmentBreakdown): number {
  return b.pickPack + b.shipping + b.packaging + b.insurance + b.storage + b.other
}

export function addBreakdown(a: FulfillmentBreakdown, b: FulfillmentBreakdown): FulfillmentBreakdown {
  return {
    pickPack: a.pickPack + b.pickPack,
    shipping: a.shipping + b.shipping,
    packaging: a.packaging + b.packaging,
    insurance: a.insurance + b.insurance,
    storage: a.storage + b.storage,
    other: a.other + b.other,
  }
}

/** Map a ShipFusion shipment transaction's amount fields into our categories. */
export function classifyShipmentCharges(tx: {
  services?: number
  shipping?: number
  packaging?: number
  insurance?: number
  tax?: number
  total?: number
  [key: string]: unknown
}): FulfillmentBreakdown {
  const pickPack = num(tx.services)
  const shipping = num(tx.shipping)
  const packaging = num(tx.packaging)
  const insurance = num(tx.insurance)
  const tax = num(tx.tax)
  const total = num(tx.total)

  // Known fields sum; any residual vs total (credits, unnamed fees) → other
  const known = pickPack + shipping + packaging + insurance + tax
  const residual = total !== 0 ? total - known : 0
  const other = tax + residual

  return { pickPack, shipping, packaging, insurance, storage: 0, other }
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Convert billingTimestamp (unix seconds) or billingDate (YYYYMMDD) → LA calendar date. */
export function billingDateToLA(billingDate?: string | null, billingTimestamp?: number | null): string | null {
  if (billingTimestamp != null && Number.isFinite(Number(billingTimestamp)) && Number(billingTimestamp) > 0) {
    const d = new Date(Number(billingTimestamp) * 1000)
    return formatDateInTZ(d, LA_TZ)
  }
  if (billingDate && /^\d{8}$/.test(String(billingDate))) {
    const s = String(billingDate)
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  }
  if (billingDate && /^\d{4}-\d{2}-\d{2}/.test(String(billingDate))) {
    return String(billingDate).slice(0, 10)
  }
  return null
}

function formatDateInTZ(date: Date, timeZone: string): string {
  // en-CA yields YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

function toPeriodYYYYMM(isoDate: string): string {
  return isoDate.slice(0, 7).replace("-", "")
}

function monthBoundsFromYYYYMM(yyyymm: string): { start: string; end: string } {
  const y = Number(yyyymm.slice(0, 4))
  const m = Number(yyyymm.slice(4, 6))
  const start = `${yyyymm.slice(0, 4)}-${yyyymm.slice(4, 6)}-01`
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const end = `${yyyymm.slice(0, 4)}-${yyyymm.slice(4, 6)}-${String(lastDay).padStart(2, "0")}`
  return { start, end }
}

function isClosedMonth(yyyymm: string, todayISO: string): boolean {
  const { end } = monthBoundsFromYYYYMM(yyyymm)
  return end < todayISO
}

function ttlForPeriodRange(periodStart: string, periodEnd: string, todayISO: string): number {
  // If the range includes the current month, use short TTL; else long.
  const current = toPeriodYYYYMM(todayISO)
  if (periodStart <= current && current <= periodEnd) return CURRENT_MONTH_TTL_MS
  return CLOSED_MONTH_TTL_MS
}

function authHeaders(mode: "x-shipfusion-token" | "bearer", key: string): Record<string, string> {
  if (mode === "bearer") {
    return { Authorization: `Bearer ${key}`, Accept: "application/json" }
  }
  return { "X-SHIPFUSION-TOKEN": key, Accept: "application/json" }
}

async function shipfusionGet(
  path: string,
  key: string,
  preferredMode: AuthModeUsed
): Promise<{ ok: boolean; status: number; json: any; mode: AuthModeUsed }> {
  const modes: Array<"x-shipfusion-token" | "bearer"> =
    preferredMode === "bearer"
      ? ["bearer", "x-shipfusion-token"]
      : ["x-shipfusion-token", "bearer"]

  let lastStatus = 0
  let lastJson: any = null

  for (const mode of modes) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "GET",
      headers: authHeaders(mode, key),
    })
    const json = await res.json().catch(() => null)
    lastStatus = res.status
    lastJson = json
    if (res.ok) {
      globalCache._shipfusionAuthMode = mode
      return { ok: true, status: res.status, json, mode }
    }
    // Only fall through to alternate auth on auth failures
    if (res.status !== 401 && res.status !== 403) {
      return { ok: false, status: res.status, json, mode }
    }
  }

  return { ok: false, status: lastStatus, json: lastJson, mode: preferredMode === "none" ? "x-shipfusion-token" : preferredMode }
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, () => worker())
  await Promise.all(workers)
  return results
}

interface InvoiceSummary {
  invoiceId: number
  period: string
  currency?: string
  total?: number
}

async function listInvoices(
  periodStart: string,
  periodEnd: string,
  key: string,
  preferredMode: AuthModeUsed
): Promise<{ invoices: InvoiceSummary[]; mode: AuthModeUsed; error?: string }> {
  const invoices: InvoiceSummary[] = []
  let page = 1
  let totalPages = 1
  let mode: AuthModeUsed = preferredMode === "none" ? "x-shipfusion-token" : preferredMode

  while (page <= totalPages && page <= 50) {
    const qs = new URLSearchParams({
      invoicePeriodStart: periodStart,
      invoicePeriodEnd: periodEnd,
      perPage: String(DEFAULT_PER_PAGE),
      page: String(page),
      currency: "USD",
      invoiceStatus: "all",
    })
    const { ok, status, json, mode: used } = await shipfusionGet(`/invoices?${qs}`, key, mode)
    mode = used
    if (!ok) {
      return { invoices, mode, error: `ShipFusion list invoices HTTP ${status}` }
    }
    const batch = Array.isArray(json?.invoices) ? json.invoices : []
    for (const inv of batch) {
      if (inv?.invoiceId != null) {
        invoices.push({
          invoiceId: Number(inv.invoiceId),
          period: String(inv.period || ""),
          currency: inv.currency,
          total: num(inv.total),
        })
      }
    }
    totalPages = Math.max(1, Number(json?.totalPages) || 1)
    page++
  }

  return { invoices, mode }
}

async function fetchInvoiceShipments(
  invoiceId: number,
  key: string,
  preferredMode: AuthModeUsed
): Promise<{ transactions: any[]; mode: AuthModeUsed; error?: string }> {
  const transactions: any[] = []
  let page = 1
  let totalPages = 1
  let mode: AuthModeUsed = preferredMode === "none" ? "x-shipfusion-token" : preferredMode

  while (page <= totalPages && page <= 100) {
    const qs = new URLSearchParams({
      type: "shipment",
      perPage: String(DEFAULT_PER_PAGE),
      page: String(page),
    })
    const { ok, status, json, mode: used } = await shipfusionGet(
      `/invoices/${invoiceId}?${qs}`,
      key,
      mode
    )
    mode = used
    if (!ok) {
      return { transactions, mode, error: `ShipFusion invoice ${invoiceId} HTTP ${status}` }
    }
    const batch = Array.isArray(json?.transactions) ? json.transactions : []
    transactions.push(...batch)
    totalPages = Math.max(1, Number(json?.totalPages) || 1)
    page++
  }

  return { transactions, mode }
}

function accumulateDaily(
  map: Map<string, FulfillmentBreakdown>,
  date: string,
  breakdown: FulfillmentBreakdown
) {
  const existing = map.get(date) || emptyBreakdown()
  map.set(date, addBreakdown(existing, breakdown))
}

/**
 * Fetch ShipFusion shipment charges for [dateStart, dateEnd] and group by LA day.
 * Results are cached by invoice-period range.
 */
export async function fetchShipFusionDailyCosts(
  dateStart: string,
  dateEnd: string
): Promise<ShipFusionFetchResult> {
  const key = getApiKey()
  if (!key) {
    console.warn("SHIPFUSION_API_KEY / SHIPFUSION_API_TOKEN missing — falling back to manual fulfillment invoices")
    return { daily: [], authMode: "none", error: "missing_api_key", invoiceCount: 0, transactionCount: 0 }
  }

  const periodStart = toPeriodYYYYMM(dateStart)
  const periodEnd = toPeriodYYYYMM(dateEnd)
  const todayISO = formatDateInTZ(new Date(), LA_TZ)
  const cacheKey = `${periodStart}|${periodEnd}`
  const cache = getCache()
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.ts < cached.ttlMs) {
    return {
      daily: filterDailyToRange(cached.daily, dateStart, dateEnd),
      authMode: cached.authMode,
      invoiceCount: cached.invoiceCount,
      transactionCount: cached.transactionCount,
    }
  }

  const preferredMode: AuthModeUsed = globalCache._shipfusionAuthMode || "x-shipfusion-token"

  try {
    const listed = await listInvoices(periodStart, periodEnd, key, preferredMode)
    if (listed.error && listed.invoices.length === 0) {
      console.error(listed.error)
      return {
        daily: [],
        authMode: listed.mode,
        error: listed.error,
        invoiceCount: 0,
        transactionCount: 0,
      }
    }

    // Skip $0 CAD placeholder rows; prefer USD. Still fetch any non-zero invoice.
    const invoices = listed.invoices.filter((inv) => {
      if (inv.currency && inv.currency !== "USD" && num(inv.total) === 0) return false
      return true
    })

    const details = await mapPool(invoices, INVOICE_FETCH_CONCURRENCY, (inv) =>
      fetchInvoiceShipments(inv.invoiceId, key, listed.mode)
    )

    const byDate = new Map<string, FulfillmentBreakdown>()
    let transactionCount = 0
    let authMode: AuthModeUsed = listed.mode

    for (const detail of details) {
      if (detail.mode) authMode = detail.mode
      if (detail.error) console.error(detail.error)
      for (const tx of detail.transactions) {
        // type=shipment filter should already limit, but be defensive
        if (tx?.type && String(tx.type).toLowerCase() !== "shipment") continue
        const date = billingDateToLA(tx.billingDate, tx.billingTimestamp)
        if (!date) continue
        const breakdown = classifyShipmentCharges(tx)
        accumulateDaily(byDate, date, breakdown)
        transactionCount++
      }
    }

    const daily: DailyFulfillmentCost[] = [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, breakdown]) => ({
        date,
        total: sumBreakdown(breakdown),
        breakdown,
      }))

    const ttlMs = ttlForPeriodRange(periodStart, periodEnd, todayISO)
    // Also tighten TTL if any month in range is still open
    const effectiveTtl =
      isClosedMonth(periodEnd, todayISO) && isClosedMonth(periodStart, todayISO)
        ? ttlMs
        : Math.min(ttlMs, CURRENT_MONTH_TTL_MS)

    cache.set(cacheKey, {
      daily,
      invoiceCount: invoices.length,
      transactionCount,
      authMode,
      ts: Date.now(),
      ttlMs: effectiveTtl,
    })

    return {
      daily: filterDailyToRange(daily, dateStart, dateEnd),
      authMode,
      invoiceCount: invoices.length,
      transactionCount,
    }
  } catch (err: any) {
    console.error("fetchShipFusionDailyCosts failed:", err?.message || err)
    return {
      daily: [],
      authMode: preferredMode === "none" ? "x-shipfusion-token" : preferredMode,
      error: err?.message || "shipfusion_fetch_failed",
      invoiceCount: 0,
      transactionCount: 0,
    }
  }
}

function filterDailyToRange(
  daily: DailyFulfillmentCost[],
  dateStart: string,
  dateEnd: string
): DailyFulfillmentCost[] {
  return daily.filter((d) => d.date >= dateStart && d.date <= dateEnd)
}

/** Sum daily ShipFusion rows into a single total + breakdown for a date range. */
export function aggregateDailyCosts(
  daily: DailyFulfillmentCost[],
  dateStart: string,
  dateEnd: string
): { total: number; breakdown: FulfillmentBreakdown; datesCovered: Set<string> } {
  let acc = emptyBreakdown()
  const datesCovered = new Set<string>()
  for (const day of daily) {
    if (day.date < dateStart || day.date > dateEnd) continue
    acc = addBreakdown(acc, day.breakdown)
    datesCovered.add(day.date)
  }
  return { total: sumBreakdown(acc), breakdown: acc, datesCovered }
}
