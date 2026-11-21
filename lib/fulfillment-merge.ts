/**
 * Pure merge of ShipFusion daily costs + manual fulfillment_invoices.
 * Kept import-free so Node's test runner can load it with a `.ts` path.
 * Precedence rules: see docs/DATA_SOURCES.md and lib/fulfillment.ts.
 */

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
  date: string
  total: number
  breakdown: FulfillmentBreakdown
}

export interface ManualInvoice {
  id: number
  label: string
  periodStart: string
  periodEnd: string
  amount: number
}

export type FulfillmentSource = "shipfusion" | "manual" | "mixed"
export type AuthModeUsed = "x-shipfusion-token" | "bearer" | "none"

export interface MergedFulfillment {
  fulfillmentInvoiceTotal: number
  fulfillmentBreakdown: FulfillmentBreakdown
  fulfillmentSource: FulfillmentSource
  shipfusionAuthMode: AuthModeUsed
  shipfusionError?: string
  shipfusionInvoiceCount: number
  shipfusionTransactionCount: number
  apiDatesCovered: string[]
  manualContribution: number
  apiContribution: number
}

function emptyBreakdown(): FulfillmentBreakdown {
  return { pickPack: 0, shipping: 0, packaging: 0, insurance: 0, storage: 0, other: 0 }
}

function sumBreakdown(b: FulfillmentBreakdown): number {
  return b.pickPack + b.shipping + b.packaging + b.insurance + b.storage + b.other
}

function addBreakdown(a: FulfillmentBreakdown, b: FulfillmentBreakdown): FulfillmentBreakdown {
  return {
    pickPack: a.pickPack + b.pickPack,
    shipping: a.shipping + b.shipping,
    packaging: a.packaging + b.packaging,
    insurance: a.insurance + b.insurance,
    storage: a.storage + b.storage,
    other: a.other + b.other,
  }
}

function aggregateDailyCosts(
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

/** Calendar-day iteration on YYYY-MM-DD (UTC-date math — no TZ drift). */
function eachDateInclusive(start: string, end: string): string[] {
  const out: string[] = []
  const cur = new Date(`${start}T00:00:00Z`)
  const last = new Date(`${end}T00:00:00Z`)
  while (cur <= last) {
    out.push(cur.toISOString().slice(0, 10))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return out
}

function overlapDays(
  rangeStart: string,
  rangeEnd: string,
  invStart: string,
  invEnd: string
): { overlapStart: string; overlapEnd: string; invoiceDays: number } | null {
  // DATE-only strings compared via UTC midnight — these are calendar labels, not instants
  const rs = new Date(`${rangeStart}T00:00:00Z`).getTime()
  const re = new Date(`${rangeEnd}T00:00:00Z`).getTime()
  const is = new Date(`${invStart}T00:00:00Z`).getTime()
  const ie = new Date(`${invEnd}T00:00:00Z`).getTime()
  const overlapStartMs = Math.max(rs, is)
  const overlapEndMs = Math.min(re, ie)
  if (overlapStartMs > overlapEndMs) return null
  const invoiceDays = Math.round((ie - is) / 86400000) + 1
  return {
    overlapStart: new Date(overlapStartMs).toISOString().slice(0, 10),
    overlapEnd: new Date(overlapEndMs).toISOString().slice(0, 10),
    invoiceDays: Math.max(1, invoiceDays),
  }
}

export function isStorageManualInvoice(label: string): boolean {
  return /\bstorage\b/i.test(label || "")
}

function prorateManual(
  invoices: ManualInvoice[],
  dateStart: string,
  dateEnd: string,
  apiCoveredDates: Set<string>,
  opts: { storageOnly?: boolean; nonStorageOnly?: boolean; skipApiCoveredDays?: boolean }
): { total: number; breakdown: FulfillmentBreakdown } {
  let breakdown = emptyBreakdown()

  for (const inv of invoices) {
    const storage = isStorageManualInvoice(inv.label)
    if (opts.storageOnly && !storage) continue
    if (opts.nonStorageOnly && storage) continue

    const overlap = overlapDays(dateStart, dateEnd, inv.periodStart, inv.periodEnd)
    if (!overlap) continue

    const dailyAmount = inv.amount / overlap.invoiceDays
    const days = eachDateInclusive(overlap.overlapStart, overlap.overlapEnd)
    let usedDays = 0
    for (const d of days) {
      if (opts.skipApiCoveredDays && !storage && apiCoveredDates.has(d)) continue
      usedDays++
    }
    const amount = dailyAmount * usedDays
    if (amount === 0) continue

    if (storage) {
      breakdown = addBreakdown(breakdown, { ...emptyBreakdown(), storage: amount })
    } else {
      breakdown = addBreakdown(breakdown, { ...emptyBreakdown(), other: amount })
    }
  }

  return { total: sumBreakdown(breakdown), breakdown }
}

export function mergeFulfillmentCosts(params: {
  dateStart: string
  dateEnd: string
  shipfusionDaily: DailyFulfillmentCost[]
  shipfusionError?: string
  shipfusionAuthMode: AuthModeUsed
  shipfusionInvoiceCount: number
  shipfusionTransactionCount: number
  manualInvoices: ManualInvoice[]
}): MergedFulfillment {
  const {
    dateStart,
    dateEnd,
    shipfusionDaily,
    shipfusionError,
    shipfusionAuthMode,
    shipfusionInvoiceCount,
    shipfusionTransactionCount,
    manualInvoices,
  } = params

  const api = aggregateDailyCosts(shipfusionDaily, dateStart, dateEnd)
  const hasApi = api.datesCovered.size > 0

  const storagePart = prorateManual(manualInvoices, dateStart, dateEnd, api.datesCovered, {
    storageOnly: true,
  })

  const manualOther = hasApi
    ? prorateManual(manualInvoices, dateStart, dateEnd, api.datesCovered, {
        nonStorageOnly: true,
        skipApiCoveredDays: true,
      })
    : prorateManual(manualInvoices, dateStart, dateEnd, new Set(), {
        nonStorageOnly: true,
        skipApiCoveredDays: false,
      })

  const breakdown = addBreakdown(addBreakdown(api.breakdown, storagePart.breakdown), manualOther.breakdown)
  const apiContribution = api.total
  const manualContribution = storagePart.total + manualOther.total
  const fulfillmentInvoiceTotal = sumBreakdown(breakdown)

  let fulfillmentSource: FulfillmentSource
  if (apiContribution > 0 && manualContribution > 0) fulfillmentSource = "mixed"
  else if (apiContribution > 0) fulfillmentSource = "shipfusion"
  else fulfillmentSource = "manual"

  return {
    fulfillmentInvoiceTotal,
    fulfillmentBreakdown: breakdown,
    fulfillmentSource,
    shipfusionAuthMode,
    shipfusionError,
    shipfusionInvoiceCount,
    shipfusionTransactionCount,
    apiDatesCovered: [...api.datesCovered].sort(),
    manualContribution,
    apiContribution,
  }
}
