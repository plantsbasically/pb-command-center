"use client"
import { useState, useEffect, useCallback, useRef } from "react"

interface Metrics {
  revenue: number
  shopifyRevenue: number
  amazonRevenue: number
  tiktokRevenue: number
  cogs: number
  shopifyCOGS: number
  amazonCOGS: number
  tiktokCOGS: number
  grossProfit: number
  grossMarginPct: number
  shippingCollected: number
  fulfillmentInvoiceTotal: number
  netFulfillmentCost: number
  amazonFeeInvoiceTotal: number
  tiktokFees: number
  gatewayFees: number
  adSpend: number
  contributionProfit: number
  contributionMarginPct: number
  trueContributionMargin: number
  trueContributionMarginPct: number
  fixedCosts: number
  netProfit: number
  netMarginPct: number
  newCustomers: number
  totalCustomers: number
  cac: number
  ltv: number
  ltvCacRatio: number
  ordersCount: number
  aov: number
}

interface FulfillmentBreakdown {
  pickPack: number
  shipping: number
  packaging: number
  insurance: number
  storage: number
  other: number
}

type FulfillmentSource = "shipfusion" | "manual" | "mixed"

interface DailyContribution {
  /** @deprecated use dateStart/dateEnd/label — kept for older payloads */
  date?: string
  dateStart?: string
  dateEnd?: string
  label?: string
  isTodayOnly?: boolean
  contributionMargin: number
  contributionMarginPct: number
  contributionProfit?: number
  revenue: number
  adSpend: number
  cogs: number
  gatewayFees?: number
  netFulfillmentCost?: number
  fulfillmentInvoiceTotal?: number
  fulfillmentSource?: FulfillmentSource
  fulfillmentBreakdown?: FulfillmentBreakdown
  components: {
    shopifyRevenue: number
    amazonRevenue: number
    tiktokRevenue: number
    shopifyCOGS: number
    amazonCOGS: number
    tiktokCOGS: number
    giftCOGS: number
    giftRetailDiscounted: number
    gatewayFees?: number
  }
  formula: string
  todaySecondary?: {
    date: string
    contributionMargin: number
    contributionMarginPct: number
    revenue: number
  } | null
}

interface GiftPlanMapping {
  planKey: string
  planName: string
  status: "confirmed" | "inferred" | "todo"
  parentSkus: string[]
  welcomeGifts: { sku: string; qty: number }[]
  notes?: string
  todos: string[]
}

interface DiscountStats {
  totalDiscounts: number
  byCategory: {
    promotional: number
    subscription: number
    freeGifts: number
    other: number
  }
  topCodes: { code: string; amount: number; orderCount: number }[]
  ordersWithDiscounts: number
  allocationSum: number
}

interface FulfillmentInvoice {
  id: number
  label: string
  periodStart: string
  periodEnd: string
  amount: number
}

interface COGSVariant {
  variantKey: string
  variantName: string
  shopifyVariantId: string
  shopifyProductId: string
  lineItems: { name: string; cost: number; quantity: number }[]
  totalCost: number
}

interface FixedCostLine {
  name: string
  monthlyCost: number
}

interface COGSBreakdown {
  variantKey: string
  variantName: string
  totalCost: number
  unitsSold: number
  totalCOGS: number
}

interface ChannelSpend {
  facebook: number
  google: number
  microsoft: number
  tiktok: number
  snapchat: number
  pinterest: number
  amazonAds: number
}

interface TWData {
  adSpend: number
  channelSpend: ChannelSpend
  attributedRevenue: number
  blendedCac: number
  blendedRoas: number
  amazonFees: number
}

interface LoopData {
  activeSubscribers: number
  subscriberMRR: number
}

/** Pacific (America/Los_Angeles) calendar presets — never UTC toISOString day math. */
function pacificYmd(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d)
}

function addDaysYmd(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

function startOfMonthYmd(iso: string): string {
  return `${iso.slice(0, 7)}-01`
}

function previousMonthRange(iso: string): { start: string; end: string } {
  const thisStart = startOfMonthYmd(iso)
  const lastDayPrev = addDaysYmd(thisStart, -1)
  return { start: startOfMonthYmd(lastDayPrev), end: lastDayPrev }
}

const PRESETS: Record<string, () => { start: string; end: string }> = {
  "Last 7d": () => {
    const end = pacificYmd()
    return { start: addDaysYmd(end, -7), end }
  },
  "Last 30d": () => {
    const end = pacificYmd()
    return { start: addDaysYmd(end, -30), end }
  },
  "Last 90d": () => {
    const end = pacificYmd()
    return { start: addDaysYmd(end, -90), end }
  },
  "Last 180d": () => {
    const end = pacificYmd()
    return { start: addDaysYmd(end, -180), end }
  },
  "Month to Date": () => {
    const end = pacificYmd()
    return { start: startOfMonthYmd(end), end }
  },
  "Last Month": () => previousMonthRange(pacificYmd()),
}

function fmt(n: number, currency = true): string {
  if (!isFinite(n)) return "N/A"
  return currency
    ? "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : n.toFixed(2)
}

function fmtPct(n: number): string {
  if (!isFinite(n)) return "N/A"
  return n.toFixed(1) + "%"
}

/** Animated count-up for the daily contribution margin hero. */
function CountUp({ value, durationMs = 1200 }: { value: number; durationMs?: number }) {
  const [display, setDisplay] = useState(0)
  const prev = useRef(0)

  useEffect(() => {
    const from = prev.current
    const to = value
    prev.current = to
    if (!isFinite(to)) {
      setDisplay(0)
      return
    }
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs)
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(from + (to - from) * eased)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, durationMs])

  const sign = display < 0 ? "−" : ""
  return (
    <span>
      {sign}$
      {Math.abs(display).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}
    </span>
  )
}

export default function Dashboard() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [variants, setVariants] = useState<COGSVariant[]>([])
  const [fixedCosts, setFixedCosts] = useState<FixedCostLine[]>([])
  const [cogsBreakdown, setCogsBreakdown] = useState<COGSBreakdown[]>([])
  const [twData, setTwData] = useState<TWData | null>(null)
  const [loopData, setLoopData] = useState<LoopData | null>(null)
  const [subscriptionRevenue, setSubscriptionRevenue] = useState<number>(0)
  const [subscriptionOrderCount, setSubscriptionOrderCount] = useState<number>(0)
  const [dailyContribution, setDailyContribution] = useState<DailyContribution | null>(null)
  const [giftPlans, setGiftPlans] = useState<GiftPlanMapping[]>([])
  const [discountStats, setDiscountStats] = useState<DiscountStats | null>(null)
  const [gatewayFees, setGatewayFees] = useState(0)
  const [gatewayFeesSource, setGatewayFeesSource] = useState<"tw_sql" | "tw_summary" | "none">("none")
  const [dateStart, setDateStart] = useState(() => startOfMonthYmd(pacificYmd()))
  const [dateEnd, setDateEnd] = useState(() => pacificYmd())
  const [fulfillmentCoverage, setFulfillmentCoverage] = useState<{
    source: string | null
    gross: number
    shippingCollected: number
    net: number
    breakdown: FulfillmentBreakdown
    daysUsed: number
    missingDays: string[]
    hasManualBackup: boolean
    hasShipFusion: boolean
    noShipFusionDataYet: boolean
    daysWithoutShipFusion?: number
  } | null>(null)
  const [editingCOGS, setEditingCOGS] = useState(false)
  const [editingFixed, setEditingFixed] = useState(false)
  const [localVariants, setLocalVariants] = useState<COGSVariant[]>([])
  const [localFixed, setLocalFixed] = useState<FixedCostLine[]>([])
  const [newFixedName, setNewFixedName] = useState("")
  const [newFixedCost, setNewFixedCost] = useState("")
  const [syncing, setSyncing] = useState(false)
  const [fulfillmentInvoices, setFulfillmentInvoices] = useState<FulfillmentInvoice[]>([])
  const [fulfillmentSource, setFulfillmentSource] = useState<FulfillmentSource | null>(null)
  const [fulfillmentBreakdown, setFulfillmentBreakdown] = useState<FulfillmentBreakdown | null>(null)
  const [newInvoiceLabel, setNewInvoiceLabel] = useState("")
  const [newInvoiceStart, setNewInvoiceStart] = useState("")
  const [newInvoiceEnd, setNewInvoiceEnd] = useState("")
  const [newInvoiceAmount, setNewInvoiceAmount] = useState("")
  const [addingInvoice, setAddingInvoice] = useState(false)
  const [showAllDatePresets, setShowAllDatePresets] = useState(false)

  const fetchData = useCallback(async (bust = false) => {
    setLoading(true)
    setError(null)
    try {
      const url = `/api?start=${dateStart}&end=${dateEnd}${bust ? "&bust=1" : ""}`
      const res = await fetch(url)
      if (res.status === 401) {
        throw new Error("Authentication required")
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }))
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      const json = await res.json()
      setMetrics(json.metrics)
      setVariants(json.variants || [])
      setFixedCosts(json.fixedCosts || [])
      setCogsBreakdown(json.cogsBreakdown || [])
      setFulfillmentInvoices(json.fulfillmentInvoices || [])
      setFulfillmentSource(json.fulfillmentSource || null)
      setFulfillmentBreakdown(json.fulfillmentBreakdown || null)
      setFulfillmentCoverage(json.fulfillmentCoverage || null)
      setTwData(json.twData || null)
      setLoopData(json.loopData || null)
      setSubscriptionRevenue(json.subscriptionRevenue ?? 0)
      setSubscriptionOrderCount(json.subscriptionOrderCount ?? 0)
      setDailyContribution(json.dailyContribution || null)
      setGiftPlans(json.giftMappings?.plans || [])
      setDiscountStats(json.discountStats || null)
      setGatewayFees(Number(json.gatewayFees ?? json.metrics?.gatewayFees ?? 0) || 0)
      setGatewayFeesSource(json.gatewayFeesSource || "none")
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [dateStart, dateEnd])

  useEffect(() => {
    fetchData(false)
  }, [fetchData])

  const saveCOGS = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/admin", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "updateCOGS",
          data: { variants: localVariants },
        }),
      })
      const json = await res.json()
      if (json.ok) {
        const updatedVariants = json.data.variants
        setVariants(updatedVariants)
        // Immediately update the view-mode breakdown so names/costs show instantly
        // without waiting 20-30s for fetchData(true) to return
        setCogsBreakdown(prev => updatedVariants.map((v: COGSVariant) => {
          const existing = prev.find(cb => cb.variantKey === v.variantKey)
          const unitsSold = existing?.unitsSold ?? 0
          return {
            variantKey: v.variantKey,
            variantName: v.variantName,
            totalCost: v.totalCost,
            unitsSold,
            totalCOGS: unitsSold * v.totalCost,
          }
        }))
        setEditingCOGS(false)
        fetchData(true)
      } else {
        setError(json.error || "Failed to save COGS")
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const saveFixedCosts = async () => {
    setLoading(true)
    try {
      // Auto-include any item typed in the "new" row but not yet confirmed with +
      const pending = newFixedName.trim()
        ? [{ name: newFixedName.trim(), monthlyCost: parseFloat(newFixedCost) || 0 }]
        : []
      const itemsToSave = [...localFixed, ...pending]

      const res = await fetch("/api/admin", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "updateFixedCosts",
          data: { lineItems: itemsToSave },
        }),
      })
      const json = await res.json()
      if (json.ok) {
        setFixedCosts(json.data)
        setEditingFixed(false)
        setNewFixedName("")
        setNewFixedCost("")
        fetchData(true)
      } else {
        setError(json.error || "Failed to save fixed costs")
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const updateVariantLineItem = (variantIdx: number, lineIdx: number, field: string, value: any) => {
    setLocalVariants(prev => prev.map((v, i) => {
      if (i !== variantIdx) return v
      const newLineItems = v.lineItems.map((item, li) =>
        li !== lineIdx ? item : { ...item, [field]: field === "name" ? value : parseFloat(value) || 0 }
      )
      return { ...v, lineItems: newLineItems, totalCost: newLineItems.reduce((s, it) => s + it.cost * it.quantity, 0) }
    }))
  }

  const addVariantLineItem = (variantIdx: number) => {
    setLocalVariants(prev => prev.map((v, i) => {
      if (i !== variantIdx) return v
      const newLineItems = [...v.lineItems, { name: "New Item", cost: 0, quantity: 1 }]
      return { ...v, lineItems: newLineItems }
    }))
  }

  const removeVariantLineItem = (variantIdx: number, lineIdx: number) => {
    setLocalVariants(prev => prev.map((v, i) => {
      if (i !== variantIdx) return v
      const newLineItems = v.lineItems.filter((_, li) => li !== lineIdx)
      return { ...v, lineItems: newLineItems, totalCost: newLineItems.reduce((s, it) => s + it.cost * it.quantity, 0) }
    }))
  }

  const addVariant = () => {
    setLocalVariants([
      ...localVariants,
      {
        variantKey: `NEW-${Date.now()}`,
        variantName: "New Variant",
        shopifyVariantId: "",
        shopifyProductId: "",
        lineItems: [],
        totalCost: 0,
      },
    ])
  }

  const syncFromShopify = async () => {
    setSyncing(true)
    try {
      const res = await fetch("/api/admin")
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || "Sync failed")

      const shopifyVariants: { variantKey: string; variantName: string; shopifyVariantId: string; shopifyProductId: string }[] = json.products

      setLocalVariants(prev => {
        // For each Shopify variant: keep existing line items if already configured, else add blank
        const merged = shopifyVariants.map(sv => {
          const existing = prev.find(
            lv => lv.variantKey === sv.variantKey || lv.shopifyVariantId === sv.shopifyVariantId
          )
          if (existing) {
            // Keep costs, just refresh name and IDs so they match Shopify exactly
            return { ...existing, variantName: sv.variantName, variantKey: sv.variantKey, shopifyVariantId: sv.shopifyVariantId, shopifyProductId: sv.shopifyProductId }
          }
          return { variantKey: sv.variantKey, variantName: sv.variantName, shopifyVariantId: sv.shopifyVariantId, shopifyProductId: sv.shopifyProductId, lineItems: [], totalCost: 0 }
        })
        // Preserve any manually added variants not found in Shopify
        const manual = prev.filter(
          lv => !shopifyVariants.find(sv => sv.variantKey === lv.variantKey || sv.shopifyVariantId === lv.shopifyVariantId)
        )
        return [...merged, ...manual]
      })
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSyncing(false)
    }
  }

  const submitInvoice = async () => {
    if (!newInvoiceAmount || !newInvoiceStart || !newInvoiceEnd) return
    setAddingInvoice(true)
    try {
      const res = await fetch("/api/admin", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "addFulfillmentInvoice",
          data: {
            label: newInvoiceLabel.trim() || "Fulfillment Invoice",
            periodStart: newInvoiceStart,
            periodEnd: newInvoiceEnd,
            amount: parseFloat(newInvoiceAmount) || 0,
          },
        }),
      })
      const json = await res.json()
      if (json.ok) {
        setFulfillmentInvoices(json.all)
        setNewInvoiceLabel("")
        setNewInvoiceStart("")
        setNewInvoiceEnd("")
        setNewInvoiceAmount("")
        fetchData(true)
      } else {
        setError(json.error || "Failed to add invoice")
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setAddingInvoice(false)
    }
  }

  const removeInvoice = async (id: number) => {
    try {
      const res = await fetch("/api/admin", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deleteFulfillmentInvoice", data: { id } }),
      })
      const json = await res.json()
      if (json.ok) {
        setFulfillmentInvoices(json.all)
        fetchData(true)
      } else {
        setError(json.error || "Failed to delete invoice")
      }
    } catch (err: any) {
      setError(err.message)
    }
  }

  const addFixedCost = () => {
    if (!newFixedName) return
    setLocalFixed([
      ...localFixed,
      { name: newFixedName, monthlyCost: parseFloat(newFixedCost) || 0 },
    ])
    setNewFixedName("")
    setNewFixedCost("")
  }

  const removeFixedCost = (idx: number) => {
    setLocalFixed(localFixed.filter((_, i) => i !== idx))
  }

  const applyPreset = (fn: keyof typeof PRESETS) => {
    const { start, end } = PRESETS[fn]()
    setDateStart(start)
    setDateEnd(end)
  }

  const m = metrics
  const ltvCacTarget = 3.0
  const ltvCacStatus = m ? (m.ltvCacRatio >= ltvCacTarget ? "positive" : m.ltvCacRatio >= 1.5 ? "warning" : "negative") : ""

  if (!m && loading && !error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-zinc-400">Loading...</div>
      </div>
    )
  }

  if (error && !m) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <div className="bg-white rounded-xl border border-red-200 p-8 max-w-lg text-center shadow-sm">
          <h2 className="text-xl font-semibold text-red-600 mb-2">Something went wrong</h2>
          <p className="text-zinc-500 mb-4">{error}</p>
          <button onClick={() => fetchData(false)} className="btn-primary">
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="bg-white border-b border-zinc-200 px-4 py-4 md:px-8">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Profit Command Center</h1>
            <p className="text-zinc-500 text-sm">Plants Basically — P&L & LTV:CAC</p>
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            {Object.keys(PRESETS).map((label) => (
              <button
                key={label}
                onClick={() => applyPreset(label as keyof typeof PRESETS)}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                  (label === "Month to Date" && dateStart === PRESETS["Month to Date"]().start) ||
                  (label === "Last 30d" && dateStart === PRESETS["Last 30d"]().start)
                    ? "bg-zinc-900 text-white border-zinc-900"
                    : "bg-white text-zinc-600 border-zinc-300 hover:bg-zinc-50"
                }`}
              >
                {label}
              </button>
            ))}
            <label className="flex items-center gap-1 text-xs text-zinc-500">
              <input
                type="date"
                value={dateStart}
                onChange={(e) => setDateStart(e.target.value)}
                className="border-zinc-300"
              />
              →
              <input
                type="date"
                value={dateEnd}
                onChange={(e) => setDateEnd(e.target.value)}
                className="border-zinc-300"
              />
            </label>
            <button
              onClick={() => fetchData(true)}
              disabled={loading}
              className="text-xs px-3 py-1.5 rounded-lg border bg-white text-zinc-600 border-zinc-300 hover:bg-zinc-50 disabled:opacity-40"
              title="Force refresh (bypass cache)"
            >
              ↻ Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-8 py-6 space-y-6">
        {/* Error toast */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 text-lg">×</button>
          </div>
        )}

        {/* Contribution Margin — hero (selected range totals) */}
        {dailyContribution && (
          <div className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-gradient-to-br from-zinc-900 via-zinc-800 to-emerald-950 text-white px-6 py-8 md:px-10 md:py-10 shadow-sm">
            <div
              className="pointer-events-none absolute inset-0 opacity-30"
              style={{
                backgroundImage:
                  "radial-gradient(ellipse at 20% 0%, rgba(74,222,128,0.35), transparent 50%), radial-gradient(ellipse at 90% 80%, rgba(255,255,255,0.08), transparent 40%)",
              }}
            />
            <div className="relative">
              <div className="text-xs uppercase tracking-[0.2em] text-zinc-400 mb-3">
                Contribution margin ·{" "}
                {dailyContribution.label ||
                  dailyContribution.date ||
                  `${dateStart} – ${dateEnd}`}
              </div>
              <div
                className={`text-4xl md:text-6xl font-bold tracking-tight tabular-nums ${
                  dailyContribution.contributionMargin >= 0 ? "text-emerald-400" : "text-red-400"
                }`}
              >
                <CountUp value={dailyContribution.contributionMargin} />
              </div>
              <div className="mt-2 text-sm text-zinc-400">
                {fmtPct(dailyContribution.contributionMarginPct)} of{" "}
                {dailyContribution.isTodayOnly ? "today" : "range"} revenue
              </div>
              {dailyContribution.todaySecondary && (
                <div className="mt-2 text-xs text-zinc-500 font-mono">
                  Today ({dailyContribution.todaySecondary.date}):{" "}
                  <span className="text-zinc-300">
                    {fmt(dailyContribution.todaySecondary.contributionMargin)}
                  </span>
                  {" · "}
                  {fmtPct(dailyContribution.todaySecondary.contributionMarginPct)} of{" "}
                  {fmt(dailyContribution.todaySecondary.revenue)}
                </div>
              )}
              <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-xs text-zinc-400 font-mono">
                <span>
                  Revenue <span className="text-zinc-200">{fmt(dailyContribution.revenue)}</span>
                </span>
                <span className="text-zinc-600">−</span>
                <span>
                  Ad spend <span className="text-zinc-200">{fmt(dailyContribution.adSpend)}</span>
                </span>
                <span className="text-zinc-600">−</span>
                <span>
                  COGS <span className="text-zinc-200">{fmt(dailyContribution.cogs)}</span>
                </span>
                <span className="text-zinc-600">−</span>
                <span>
                  ShipFusion fulfillment{" "}
                  <span className="text-zinc-200">{fmt(dailyContribution.netFulfillmentCost || 0)}</span>
                </span>
                <span className="text-zinc-600">−</span>
                <span>
                  Payment gateway fees{" "}
                  <span className="text-zinc-200">
                    {fmt(
                      dailyContribution.gatewayFees ??
                        dailyContribution.components.gatewayFees ??
                        0,
                    )}
                  </span>
                </span>
              </div>
              <div className="mt-3 text-[11px] text-zinc-500 max-w-2xl leading-relaxed">
                {dailyContribution.formula}. Free gifts valued at COGS
                {dailyContribution.components.giftCOGS > 0
                  ? ` (gift COGS ${fmt(dailyContribution.components.giftCOGS)}; gift retail ${fmt(dailyContribution.components.giftRetailDiscounted)} excluded from revenue)`
                  : ""}.
                {dailyContribution.fulfillmentSource
                  ? ` Fulfillment source: ${dailyContribution.fulfillmentSource}.`
                  : ""}{" "}
                Command-center only — Triple Whale unchanged.
              </div>

              {/* Gift COGS callout + information-only Discounts (never in CM math) */}
              <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">
                    {dailyContribution.isTodayOnly ? "Today" : "Range"} · gifts (COGS basis)
                  </div>
                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs font-mono text-zinc-300">
                    <span>
                      Gift COGS{" "}
                      <span className="text-zinc-100">{fmt(dailyContribution.components.giftCOGS)}</span>
                    </span>
                    <span>
                      Gift retail (excluded){" "}
                      <span className="text-zinc-100">{fmt(dailyContribution.components.giftRetailDiscounted)}</span>
                    </span>
                  </div>
                </div>

                {discountStats && (
                  <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                        Period discounts · info only
                      </div>
                      <div className="text-[10px] text-zinc-500">not in CM</div>
                    </div>
                    <div className="text-lg font-semibold tabular-nums text-zinc-100">
                      {fmt(discountStats.totalDiscounts)}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono text-zinc-400">
                      <span>
                        Promo{" "}
                        <span className="text-zinc-200">{fmt(discountStats.byCategory.promotional)}</span>
                      </span>
                      <span>
                        Subscription{" "}
                        <span className="text-zinc-200">{fmt(discountStats.byCategory.subscription)}</span>
                      </span>
                      <span>
                        Free gifts{" "}
                        <span className="text-zinc-200">{fmt(discountStats.byCategory.freeGifts)}</span>
                      </span>
                      {discountStats.byCategory.other > 0 && (
                        <span>
                          Other{" "}
                          <span className="text-zinc-200">{fmt(discountStats.byCategory.other)}</span>
                        </span>
                      )}
                    </div>
                    {discountStats.topCodes.length > 0 && (
                      <div className="mt-3 border-t border-white/10 pt-2">
                        <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Top codes</div>
                        <ul className="space-y-0.5 text-[11px] font-mono text-zinc-400">
                          {discountStats.topCodes.slice(0, 5).map((c) => (
                            <li key={c.code} className="flex justify-between gap-3">
                              <span className="truncate text-zinc-300">{c.code}</span>
                              <span className="shrink-0">
                                {fmt(c.amount)} · {c.orderCount} ord
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="mt-2 text-[10px] text-zinc-600 leading-snug">
                      Promo excludes free-gift retail. Shopify Analytics Discounts usually includes gift 100%-offs + SAVE% subscription markdowns.
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Standalone discounts card when hero hasn't loaded daily data yet but period stats exist */}
        {!dailyContribution && discountStats && (
          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-base">Discounts</h2>
              <span className="text-[10px] uppercase tracking-wide text-zinc-400">Info only · not in CM</span>
            </div>
            <div className="metric-big">{fmt(discountStats.totalDiscounts)}</div>
            <div className="metric-label mt-1">Total discounts (period)</div>
            <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
              <div>
                <div className="font-semibold">{fmt(discountStats.byCategory.promotional)}</div>
                <div className="text-xs text-zinc-400">Promotional</div>
              </div>
              <div>
                <div className="font-semibold">{fmt(discountStats.byCategory.subscription)}</div>
                <div className="text-xs text-zinc-400">Subscription</div>
              </div>
              <div>
                <div className="font-semibold">{fmt(discountStats.byCategory.freeGifts)}</div>
                <div className="text-xs text-zinc-400">Free gifts</div>
              </div>
            </div>
          </div>
        )}

        {/* Revenue by Channel */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            {
              label: "Total Blended Revenue",
              value: fmt(m?.revenue || 0),
              sub: "Shopify + Amazon + TikTok Shop",
            },
            {
              label: "Shopify Revenue",
              value: fmt(m?.shopifyRevenue || 0),
              sub: m && m.revenue > 0 ? fmtPct((m.shopifyRevenue / m.revenue) * 100) + " of total" : null,
            },
            {
              label: "Amazon Revenue",
              value: fmt(m?.amazonRevenue || 0),
              sub: m && m.revenue > 0 ? fmtPct((m.amazonRevenue / m.revenue) * 100) + " of total" : null,
            },
            {
              label: "TikTok Shop Revenue",
              value: fmt(m?.tiktokRevenue || 0),
              sub: m && m.revenue > 0 ? fmtPct((m.tiktokRevenue / m.revenue) * 100) + " of total · TW gross sales" : "TW tiktokShopsGrossSales",
            },
          ].map((card) => (
            <div key={card.label} className="card">
              <div className="metric-big">{card.value}</div>
              {card.sub && <div className="text-xs text-zinc-400 mt-0.5">{card.sub}</div>}
              <div className="metric-label mt-1">{card.label}</div>
            </div>
          ))}
        </div>

        {/* Revenue by Channel — Bar Chart */}
        {m && (
          <div className="card">
            <h2 className="font-semibold text-base mb-4">Revenue by Channel</h2>
            {(() => {
              const total = m.revenue || 1
              const shopifyDirect = Math.max(0, (m.shopifyRevenue || 0) - subscriptionRevenue)
              const channels = [
                { label: "Shopify (one-time)", value: shopifyDirect, color: "bg-zinc-800" },
                { label: "Subscriptions", value: subscriptionRevenue, color: "bg-emerald-500" },
                { label: "Amazon", value: m.amazonRevenue || 0, color: "bg-amber-500" },
                { label: "TikTok Shop", value: m.tiktokRevenue || 0, color: "bg-rose-500" },
              ]
              return (
                <div className="space-y-4">
                  {channels.map((c) => (
                    <div key={c.label}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <div className={`w-2.5 h-2.5 rounded-sm ${c.color}`} />
                          <span className="text-sm font-medium text-zinc-700">{c.label}</span>
                        </div>
                        <span className="text-sm text-zinc-500">
                          {fmt(c.value)}{total > 0 ? <span className="text-zinc-400 ml-1.5">{fmtPct((c.value / total) * 100)}</span> : null}
                        </span>
                      </div>
                      <div className="h-7 bg-zinc-100 rounded-md overflow-hidden">
                        <div
                          className={`h-full ${c.color} rounded-md transition-all duration-700`}
                          style={{ width: total > 0 ? `${Math.max(c.value > 0 ? 0.5 : 0, (c.value / total) * 100)}%` : "0%" }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>
        )}

        {/* Ad Spend by Channel */}
        {(() => {
          const cs = twData?.channelSpend
          const totalSpend = m?.adSpend || 0
          const channels: { label: string; value: number }[] = cs ? [
            { label: "Facebook", value: cs.facebook },
            { label: "Google", value: cs.google },
            { label: "Microsoft", value: cs.microsoft },
            { label: "TikTok", value: cs.tiktok },
            { label: "Snapchat", value: cs.snapchat },
            { label: "Pinterest", value: cs.pinterest },
            { label: "Amazon Ads", value: cs.amazonAds },
          ].filter((c) => c.value > 0) : []

          return (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <div className="card">
                <div className="metric-big">{fmt(totalSpend)}</div>
                <div className="metric-label mt-1">Total Blended Ad Spend</div>
              </div>
              {channels.map((c) => (
                <div key={c.label} className="card">
                  <div className="metric-big">{fmt(c.value)}</div>
                  {totalSpend > 0 && (
                    <div className="text-xs text-zinc-400 mt-0.5">{fmtPct((c.value / totalSpend) * 100)} of total</div>
                  )}
                  <div className="metric-label mt-1">{c.label}</div>
                </div>
              ))}
            </div>
          )
        })()}

        {/* ShipFusion fulfillment — range-aware, same net used in CM */}
        {m && (
          <div className="card border border-zinc-200">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
                  Selected range · 3PL
                </div>
                <div className="text-sm font-semibold text-zinc-800">ShipFusion fulfillment</div>
                <div
                  className={`metric-big mt-1 ${
                    m.fulfillmentInvoiceTotal > 0
                      ? m.netFulfillmentCost <= 0
                        ? "positive"
                        : "text-orange-600"
                      : "text-zinc-400"
                  }`}
                >
                  {m.fulfillmentInvoiceTotal > 0 ? fmt(m.netFulfillmentCost) : "—"}
                </div>
                <div className="text-xs text-zinc-500 mt-1">
                  Net of customer-paid shipping (same figure subtracted in contribution margin)
                </div>
                {(fulfillmentCoverage?.hasManualBackup ||
                  fulfillmentSource === "manual" ||
                  fulfillmentSource === "mixed") && (
                  <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
                    Manual invoice backup included
                    {fulfillmentSource ? ` · source: ${fulfillmentSource}` : ""}
                  </div>
                )}
                {fulfillmentCoverage?.noShipFusionDataYet && (
                  <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-zinc-600 bg-zinc-100 border border-zinc-200 rounded-md px-2 py-1">
                    No ShipFusion shipment charges for this range yet
                  </div>
                )}
                {(fulfillmentCoverage?.daysWithoutShipFusion ?? 0) > 0 &&
                  !fulfillmentCoverage?.noShipFusionDataYet && (
                    <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-zinc-600 bg-zinc-100 border border-zinc-200 rounded-md px-2 py-1">
                      {fulfillmentCoverage!.daysWithoutShipFusion} day(s) without ShipFusion data
                    </div>
                  )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-xs font-mono text-zinc-600 min-w-[240px]">
                {(() => {
                  const fb = fulfillmentBreakdown || fulfillmentCoverage?.breakdown
                  if (!fb) {
                    return <div className="text-zinc-400">Breakdown unavailable</div>
                  }
                  return (
                    <>
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-zinc-400">Pick &amp; pack</div>
                        <div className="text-zinc-800">{fmt(fb.pickPack)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-zinc-400">Shipping</div>
                        <div className="text-zinc-800">{fmt(fb.shipping)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-zinc-400">Packaging</div>
                        <div className="text-zinc-800">{fmt(fb.packaging)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-zinc-400">Insurance</div>
                        <div className="text-zinc-800">{fmt(fb.insurance)}</div>
                      </div>
                      {fb.storage > 0 && (
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-zinc-400">Storage (manual)</div>
                          <div className="text-zinc-800">{fmt(fb.storage)}</div>
                        </div>
                      )}
                      {fb.other > 0 && (
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-zinc-400">Other</div>
                          <div className="text-zinc-800">{fmt(fb.other)}</div>
                        </div>
                      )}
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-zinc-400">Gross 3PL</div>
                        <div className="text-zinc-800">{fmt(m.fulfillmentInvoiceTotal)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-zinc-400">− Customer shipping</div>
                        <div className="text-zinc-800">{fmt(m.shippingCollected)}</div>
                      </div>
                    </>
                  )
                })()}
              </div>
            </div>
          </div>
        )}

        {/* Row 1 — P&L Waterfall */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-4">
          {[
            {
              label: "COGS",
              value: fmt(m?.cogs || 0),
              pct: null,
              cls: "text-red-600",
              hint: m
                ? [
                    `Shopify ${fmt(m.shopifyCOGS)}`,
                    m.amazonCOGS > 0 ? `Amazon ~${fmt(m.amazonCOGS)} est.` : null,
                    m.tiktokCOGS > 0 ? `TikTok ~${fmt(m.tiktokCOGS)} est.` : null,
                  ].filter(Boolean).join(" + ")
                : null,
            },
            {
              label: "Gross Profit",
              value: fmt(m?.grossProfit || 0),
              pct: fmtPct(m?.grossMarginPct || 0),
              cls: m && m.grossProfit >= 0 ? "positive" : "negative",
              hint: null,
            },
            {
              label: "ShipFusion fulfillment",
              value: m && m.fulfillmentInvoiceTotal > 0 ? fmt(m.netFulfillmentCost) : "—",
              pct: null,
              cls: m && m.fulfillmentInvoiceTotal > 0 ? (m.netFulfillmentCost <= 0 ? "positive" : "text-orange-600") : "text-zinc-400",
              hint: (() => {
                const fb = fulfillmentBreakdown || fulfillmentCoverage?.breakdown
                if (m && m.fulfillmentInvoiceTotal > 0 && fb) {
                  const parts = [
                    `Pick & pack ${fmt(fb.pickPack)}`,
                    `Shipping ${fmt(fb.shipping)}`,
                    `Packaging ${fmt(fb.packaging)}`,
                    fb.insurance > 0 ? `Insurance ${fmt(fb.insurance)}` : null,
                    fb.storage > 0 ? `Storage ${fmt(fb.storage)}` : null,
                    fb.other > 0 ? `Other ${fmt(fb.other)}` : null,
                    `− customer shipping ${fmt(m.shippingCollected)}`,
                  ].filter(Boolean)
                  const flags: string[] = []
                  if (fulfillmentCoverage?.hasManualBackup || fulfillmentSource === "manual" || fulfillmentSource === "mixed") {
                    flags.push("includes manual invoice backup")
                  }
                  if (fulfillmentCoverage?.noShipFusionDataYet) {
                    flags.push("no ShipFusion data for range yet")
                  } else if (fulfillmentCoverage?.missingDays?.length) {
                    flags.push(`${fulfillmentCoverage.missingDays.length} day(s) missing from store`)
                  }
                  return `${parts.join(" · ")}${flags.length ? ` · ${flags.join("; ")}` : ""}`
                }
                if (fulfillmentCoverage?.noShipFusionDataYet || fulfillmentSource === "shipfusion") {
                  return "ShipFusion connected — no charges in selected range yet"
                }
                return "ShipFusion API or manual invoice needed"
              })(),
            },
            {
              label: "Amazon Fees",
              value: m && m.amazonFeeInvoiceTotal > 0 ? fmt(m.amazonFeeInvoiceTotal) : "—",
              pct: null,
              cls: m && m.amazonFeeInvoiceTotal > 0 ? "text-orange-600" : "text-zinc-400",
              hint: "FBA handling fees · sourced from Triple Whale",
            },
            {
              label: "Payment gateway fees",
              value: m && (m.gatewayFees ?? gatewayFees) > 0 ? fmt(m.gatewayFees ?? gatewayFees) : "—",
              pct: null,
              cls: m && (m.gatewayFees ?? gatewayFees) > 0 ? "text-orange-600" : "text-zinc-400",
              hint:
                gatewayFeesSource === "tw_sql"
                  ? "Shopify only · TW orders_table.payment_gateway_costs"
                  : gatewayFeesSource === "tw_summary"
                    ? "Shopify blended · TW summary payment_gateway_costs"
                    : "Triple Whale payment gateway costs (Shopify only)",
            },
            {
              label: "Contribution Profit",
              value: fmt(m?.contributionProfit || 0),
              pct: fmtPct(m?.contributionMarginPct || 0),
              cls: m ? (m.contributionProfit >= 0 ? "positive" : "negative") : "",
              hint: "after product cost, fulfillment, marketplace fees, gateway fees & ad spend",
            },
            {
              label: "Net Profit",
              value: fmt(m?.netProfit || 0),
              pct: fmtPct(m?.netMarginPct || 0),
              cls: m && m.netProfit >= 0 ? "positive" : "negative",
              hint: "after everything — did the business actually make money this period?",
            },
          ].map((metric) => (
            <div key={metric.label} className="card">
              <div className={`metric-big ${metric.cls}`}>{metric.value}</div>
              {metric.pct && <div className={`text-sm font-semibold ${metric.cls} mt-0.5`}>{metric.pct}</div>}
              <div className="metric-label mt-1">{metric.label}</div>
              {metric.hint && <div className="text-xs text-zinc-400 mt-1 leading-snug">{metric.hint}</div>}
            </div>
          ))}
        </div>

        {/* Row 2 — Acquisition & Customer Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "CAC", value: m ? fmt(m.cac) : "—", cls: "", hint: null },
            { label: "LTV", value: m ? fmt(m.ltv) : "—", cls: "", hint: "Triple Whale all-time avg — historical lifetime spend per customer, not based on selected date range" },
            { label: "AOV", value: m ? fmt(m.aov) : "—", cls: "", hint: null },
            {
              label: "LTV:CAC",
              value: m ? m.ltvCacRatio.toFixed(2) + (isFinite(m.ltvCacRatio) ? "×" : "") : "—",
              cls: ltvCacStatus,
              hint: `${ltvCacTarget.toFixed(1)}× target`,
            },
          ].map((metric) => (
            <div key={metric.label} className="card">
              <div className={`metric-big ${metric.cls}`}>{metric.value}</div>
              <div className="metric-label mt-1">{metric.label}</div>
              {metric.hint && <div className="text-xs text-zinc-400 mt-1 leading-snug">{metric.hint}</div>}
            </div>
          ))}
        </div>

        {/* Row 3 — Orders & Customers */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Orders", value: m?.ordersCount?.toLocaleString() || 0 },
            { label: "New Customers", value: m?.newCustomers?.toLocaleString() || 0 },
            { label: "Total Customers", value: m?.totalCustomers?.toLocaleString() || 0 },
          ].map((metric) => (
            <div key={metric.label} className="card">
              <div className="metric-big">{metric.value}</div>
              <div className="metric-label mt-1">{metric.label}</div>
            </div>
          ))}
        </div>

        {/* Subscription — period renewal revenue */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="card">
            <div className="metric-big">
              {subscriptionRevenue > 0 ? fmt(subscriptionRevenue) : "—"}
            </div>
            <div className="metric-label mt-1">Subscription Revenue</div>
            <div className="text-xs text-zinc-400 mt-1 leading-snug">
              {subscriptionOrderCount > 0
                ? `${subscriptionOrderCount.toLocaleString()} renewal orders · period`
                : "renewal orders in period"}
            </div>
          </div>
          <div className="card">
            <div className={`metric-big ${subscriptionRevenue > 0 && m && m.shopifyRevenue > 0 ? "positive" : "text-zinc-400"}`}>
              {subscriptionRevenue > 0 && m && m.shopifyRevenue > 0
                ? fmtPct((subscriptionRevenue / m.shopifyRevenue) * 100)
                : "—"}
            </div>
            <div className="metric-label mt-1">Sub Revenue Share</div>
            <div className="text-xs text-zinc-400 mt-1 leading-snug">renewal revenue vs. Shopify revenue · period</div>
          </div>
        </div>

        {/* LTV:CAC Target Indicator */}
        {m && (
          <div className="card flex items-center gap-4">
            <div>
              <div className="metric-label">LTV:CAC Target</div>
              <div className="text-sm text-zinc-600 mt-0.5">
                {ltvCacTarget.toFixed(1)}× minimum · Current: <strong className={ltvCacStatus}>{m.ltvCacRatio.toFixed(2)}×</strong>
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <div className="w-32 h-2 bg-zinc-200 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${ltvCacStatus}`}
                  style={{ width: `${Math.min(100, (m.ltvCacRatio / ltvCacTarget) * 100)}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Subscription → free gift mapping */}
        {giftPlans.length > 0 && (
          <div className="card">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-semibold text-base">Subscription → Free Gift Mapping</h2>
            </div>
            <p className="text-xs text-zinc-400 mb-4 leading-snug">
              Welcome-kit gifts are valued at COGS (not retail). Seeded from Shopify gift lines + Notion SOP.
              Rows marked TODO need Kyle&apos;s confirmation. Editable via admin <code className="text-[10px]">updateGiftMappings</code>.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-zinc-500 text-xs uppercase border-b border-zinc-200">
                    <th className="text-left py-2 px-2 font-medium">Plan</th>
                    <th className="text-left py-2 px-2 font-medium">Status</th>
                    <th className="text-left py-2 px-2 font-medium">Parent SKUs</th>
                    <th className="text-left py-2 px-2 font-medium">Welcome gifts</th>
                    <th className="text-left py-2 px-2 font-medium">TODOs</th>
                  </tr>
                </thead>
                <tbody>
                  {giftPlans.map((p) => (
                    <tr key={p.planKey} className="border-b border-zinc-100 align-top">
                      <td className="py-2.5 px-2">
                        <div className="font-medium text-zinc-800">{p.planName}</div>
                        {p.notes && <div className="text-xs text-zinc-400 mt-0.5">{p.notes}</div>}
                      </td>
                      <td className="py-2.5 px-2">
                        <span
                          className={`text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded ${
                            p.status === "confirmed"
                              ? "bg-emerald-50 text-emerald-700"
                              : p.status === "inferred"
                                ? "bg-amber-50 text-amber-700"
                                : "bg-zinc-100 text-zinc-600"
                          }`}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-2 font-mono text-xs text-zinc-600">
                        {p.parentSkus.join(", ") || "—"}
                      </td>
                      <td className="py-2.5 px-2 font-mono text-xs text-zinc-600">
                        {p.welcomeGifts.length
                          ? p.welcomeGifts.map((g) => `${g.sku}×${g.qty}`).join(", ")
                          : "—"}
                      </td>
                      <td className="py-2.5 px-2 text-xs text-orange-700">
                        {(p.todos || []).length ? (
                          <ul className="list-disc pl-4 space-y-0.5">
                            {p.todos.map((t, i) => (
                              <li key={i}>{t}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Row 4 — COGS Management */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-base">COGS by Variant</h2>
            {!editingCOGS ? (
              <div className="flex gap-2 items-center">
                <button type="button" onClick={() => { setLocalVariants(JSON.parse(JSON.stringify(variants))); setEditingCOGS(true); }} className="btn-primary">
                  Edit COGS
                </button>
              </div>
            ) : (
              <div className="flex gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={syncFromShopify}
                  disabled={syncing}
                  className="btn-outline text-xs disabled:opacity-40"
                >
                  {syncing ? "Syncing..." : "↻ Sync from Shopify"}
                </button>
                <button type="button" onClick={saveCOGS} className="btn-primary">Save</button>
                <button type="button" onClick={() => setEditingCOGS(false)} className="btn-outline">Cancel</button>
              </div>
            )}
          </div>
          {editingCOGS ? (
            <div className="space-y-4">
              {localVariants.map((variant, vi) => (
                <div key={vi} className="border border-zinc-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex gap-2 items-center">
                      <input
                        value={variant.variantKey}
                        onChange={(e) => {
                          const val = e.target.value
                          setLocalVariants(prev => prev.map((v, i) => i !== vi ? v : { ...v, variantKey: val }))
                        }}
                        className="font-mono text-sm w-32"
                      />
                      <input
                        value={variant.variantName}
                        onChange={(e) => {
                          const val = e.target.value
                          setLocalVariants(prev => prev.map((v, i) => i !== vi ? v : { ...v, variantName: val }))
                        }}
                        className="text-sm flex-1"
                      />
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-sm font-semibold positive">${variant.totalCost.toFixed(2)} / unit</div>
                      <button
                        type="button"
                        onClick={() => setLocalVariants(prev => prev.filter((_, i) => i !== vi))}
                        className="text-xs text-zinc-400 hover:text-red-500 border border-zinc-200 hover:border-red-300 rounded px-2 py-0.5"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-zinc-500 text-xs uppercase">
                        <th className="text-left pb-2">Item</th>
                        <th className="text-right pb-2 w-20">Cost</th>
                        <th className="text-right pb-2 w-16">Qty</th>
                        <th className="text-right pb-2 w-20">Total</th>
                        <th className="w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {variant.lineItems.map((item, li) => (
                        <tr key={li} className="border-t border-zinc-100">
                          <td className="py-1.5">
                            <input
                              value={item.name}
                              onChange={(e) => updateVariantLineItem(vi, li, "name", e.target.value)}
                              className="w-full"
                            />
                          </td>
                          <td className="py-1.5 text-right">
                            <input
                              type="number"
                              step="0.01"
                              value={item.cost}
                              onChange={(e) => updateVariantLineItem(vi, li, "cost", e.target.value)}
                              className="w-20 text-right"
                            />
                          </td>
                          <td className="py-1.5 text-right">
                            <input
                              type="number"
                              step="1"
                              min="1"
                              value={item.quantity}
                              onChange={(e) => updateVariantLineItem(vi, li, "quantity", e.target.value)}
                              className="w-16 text-right"
                            />
                          </td>
                          <td className="py-1.5 text-right font-medium">${(item.cost * item.quantity).toFixed(2)}</td>
                          <td className="py-1.5 text-right">
                            <button type="button" onClick={() => removeVariantLineItem(vi, li)} className="text-zinc-400 hover:text-red-500 px-1">×</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button
                    type="button"
                    onClick={() => addVariantLineItem(vi)}
                    className="mt-2 text-xs text-zinc-500 hover:text-zinc-900 flex items-center gap-1"
                  >
                    + Add line item
                  </button>
                </div>
              ))}
              <button type="button" onClick={addVariant} className="btn-outline text-xs">+ Add Variant</button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-zinc-500 text-xs uppercase border-b border-zinc-200">
                    <th className="text-left py-3 px-2 font-medium">Variant</th>
                    <th className="text-right py-3 px-2 font-medium">COGS/Unit</th>
                    <th className="text-right py-3 px-2 font-medium">Units Sold</th>
                    <th className="text-right py-3 px-2 font-medium">Total COGS</th>
                  </tr>
                </thead>
                <tbody>
                  {cogsBreakdown.map((cb) => (
                    <tr key={cb.variantKey} className="border-b border-zinc-100">
                      <td className="py-3 px-2 font-mono text-xs">{cb.variantName}</td>
                      <td className="py-3 px-2 text-right">${cb.totalCost.toFixed(2)}</td>
                      <td className="py-3 px-2 text-right">{cb.unitsSold}</td>
                      <td className="py-3 px-2 text-right font-medium">${cb.totalCOGS.toFixed(2)}</td>
                    </tr>
                  ))}
                  {m && m.amazonCOGS > 0 && (
                    <tr className="border-b border-zinc-100 bg-amber-50/50">
                      <td className="py-3 px-2 text-xs text-zinc-500 italic">
                        Amazon (estimated at Shopify COGS rate)
                      </td>
                      <td className="py-3 px-2 text-right text-zinc-400 text-xs">—</td>
                      <td className="py-3 px-2 text-right text-zinc-400 text-xs">—</td>
                      <td className="py-3 px-2 text-right font-medium text-zinc-500">~{fmt(m.amazonCOGS)}</td>
                    </tr>
                  )}
                  {m && m.tiktokCOGS > 0 && (
                    <tr className="border-b border-zinc-100 bg-rose-50/50">
                      <td className="py-3 px-2 text-xs text-zinc-500 italic">
                        TikTok Shop (estimated at Shopify COGS rate)
                      </td>
                      <td className="py-3 px-2 text-right text-zinc-400 text-xs">—</td>
                      <td className="py-3 px-2 text-right text-zinc-400 text-xs">—</td>
                      <td className="py-3 px-2 text-right font-medium text-zinc-500">~{fmt(m.tiktokCOGS)}</td>
                    </tr>
                  )}
                  {(cogsBreakdown.length === 0 || variants.length === 0) && (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-zinc-400 text-sm">
                        No COGS data configured yet. Click "Edit COGS" to set up variant costs.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Fulfillment — ShipFusion primary + manual backup */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold text-base">Fulfillment</h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                ShipFusion billing (primary) vs. shipping collected
                {fulfillmentSource ? ` · source: ${fulfillmentSource}` : ""}
              </p>
            </div>
            {fulfillmentSource && (
              <span className="text-xs font-medium uppercase tracking-wide px-2 py-1 rounded bg-zinc-100 text-zinc-600">
                {fulfillmentSource}
              </span>
            )}
          </div>

          {/* Summary stats */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="bg-zinc-50 rounded-lg p-3">
              <div className="text-sm font-semibold text-zinc-700">{m ? fmt(m.shippingCollected) : "—"}</div>
              <div className="text-xs text-zinc-400 mt-0.5">Shipping collected (period)</div>
            </div>
            <div className="bg-zinc-50 rounded-lg p-3">
              <div className="text-sm font-semibold text-zinc-700">
                {m && m.fulfillmentInvoiceTotal > 0 ? fmt(m.fulfillmentInvoiceTotal) : "—"}
              </div>
              <div className="text-xs text-zinc-400 mt-0.5">3PL cost (period)</div>
            </div>
            <div className={`rounded-lg p-3 ${m && m.fulfillmentInvoiceTotal > 0 ? (m.netFulfillmentCost <= 0 ? "bg-green-50" : "bg-orange-50") : "bg-zinc-50"}`}>
              <div className={`text-sm font-semibold ${m && m.fulfillmentInvoiceTotal > 0 ? (m.netFulfillmentCost <= 0 ? "text-green-700" : "text-orange-700") : "text-zinc-400"}`}>
                {m && m.fulfillmentInvoiceTotal > 0 ? fmt(m.netFulfillmentCost) : "—"}
              </div>
              <div className="text-xs text-zinc-400 mt-0.5">Net fulfillment cost</div>
            </div>
          </div>

          {fulfillmentBreakdown && m && m.fulfillmentInvoiceTotal > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 mb-5">
              {([
                ["Pick & pack", fulfillmentBreakdown.pickPack],
                ["Shipping", fulfillmentBreakdown.shipping],
                ["Packaging", fulfillmentBreakdown.packaging],
                ["Insurance", fulfillmentBreakdown.insurance],
                ["Storage", fulfillmentBreakdown.storage],
                ["Other", fulfillmentBreakdown.other],
              ] as const).map(([label, value]) => (
                <div key={label} className="bg-zinc-50 rounded-lg p-2.5">
                  <div className="text-sm font-semibold text-zinc-700">{fmt(value)}</div>
                  <div className="text-xs text-zinc-400 mt-0.5">{label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Manual backup invoice list */}
          {fulfillmentInvoices.length > 0 && (
            <div className="mb-4">
              <div className="text-xs font-medium text-zinc-500 uppercase mb-2">
                Manual backup invoices (storage / uncovered periods)
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-zinc-500 text-xs uppercase border-b border-zinc-200">
                    <th className="text-left py-2 px-2 font-medium">Invoice</th>
                    <th className="text-left py-2 px-2 font-medium">Period</th>
                    <th className="text-right py-2 px-2 font-medium">Amount</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {fulfillmentInvoices.map((inv) => (
                    <tr key={inv.id} className="border-b border-zinc-100">
                      <td className="py-2.5 px-2 text-sm">{inv.label || "Fulfillment Invoice"}</td>
                      <td className="py-2.5 px-2 text-xs text-zinc-500">{inv.periodStart} → {inv.periodEnd}</td>
                      <td className="py-2.5 px-2 text-right font-medium">{fmt(inv.amount)}</td>
                      <td className="py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => removeInvoice(inv.id)}
                          className="text-zinc-400 hover:text-red-500 px-1 text-lg leading-none"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Add invoice form */}
          <div className="border-t border-zinc-100 pt-4">
            <div className="text-xs font-medium text-zinc-500 uppercase mb-3">
              Add manual backup invoice
            </div>
            <p className="text-xs text-zinc-400 mb-3">
              Include &quot;storage&quot; in the label for storage fees (always added alongside ShipFusion).
              Other manuals only fill days the API does not cover.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <input
                value={newInvoiceLabel}
                onChange={(e) => setNewInvoiceLabel(e.target.value)}
                placeholder="ShipFusion storage — May 2025"
              />
              <input
                type="date"
                value={newInvoiceStart}
                onChange={(e) => setNewInvoiceStart(e.target.value)}
                placeholder="Period start"
              />
              <input
                type="date"
                value={newInvoiceEnd}
                onChange={(e) => setNewInvoiceEnd(e.target.value)}
                placeholder="Period end"
              />
              <input
                type="number"
                step="0.01"
                value={newInvoiceAmount}
                onChange={(e) => setNewInvoiceAmount(e.target.value)}
                placeholder="Invoice total ($)"
              />
              <button
                type="button"
                onClick={submitInvoice}
                disabled={addingInvoice || !newInvoiceAmount || !newInvoiceStart || !newInvoiceEnd}
                className="btn-primary disabled:opacity-40"
              >
                {addingInvoice ? "Adding..." : "+ Add Invoice"}
              </button>
            </div>
          </div>
        </div>

        {/* Row 5 — Fixed Operating Costs */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-base">Fixed Operating Costs</h2>
            {!editingFixed ? (
              <button type="button" onClick={() => { setLocalFixed(JSON.parse(JSON.stringify(fixedCosts))); setEditingFixed(true); }} className="btn-primary">
                Edit Costs
              </button>
            ) : (
              <div className="flex gap-2">
                <button type="button" onClick={saveFixedCosts} className="btn-primary">Save</button>
                <button type="button" onClick={() => setEditingFixed(false)} className="btn-outline">Cancel</button>
              </div>
            )}
          </div>
          {editingFixed ? (
            <div className="space-y-3">
              {localFixed.map((fc, i) => (
                <div key={i} className="flex items-center gap-3">
                  <input
                    value={fc.name}
                    onChange={(e) => {
                      const val = e.target.value
                      setLocalFixed(prev => prev.map((item, idx) => idx !== i ? item : { ...item, name: val }))
                    }}
                    className="flex-1"
                  />
                  <div className="text-zinc-500">$</div>
                  <input
                    type="number"
                    step="0.01"
                    value={fc.monthlyCost}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0
                      setLocalFixed(prev => prev.map((item, idx) => idx !== i ? item : { ...item, monthlyCost: val }))
                    }}
                    className="w-28 text-right"
                  />
                  <button type="button" onClick={() => removeFixedCost(i)} className="text-zinc-400 hover:text-red-500 px-1">×</button>
                </div>
              ))}
              <div className="flex items-center gap-3 pt-2 border-t border-zinc-100">
                <input
                  value={newFixedName}
                  onChange={(e) => setNewFixedName(e.target.value)}
                  placeholder="New cost name..."
                  className="flex-1"
                />
                <div className="text-zinc-500">$</div>
                <input
                  type="number"
                  step="0.01"
                  value={newFixedCost}
                  onChange={(e) => setNewFixedCost(e.target.value)}
                  placeholder="0.00"
                  className="w-28 text-right"
                />
                <button type="button" onClick={addFixedCost} className="text-zinc-500 hover:text-zinc-900 text-lg">+</button>
              </div>
              <div className="text-right text-sm text-zinc-600">
                Monthly total: ${localFixed.reduce((s, fc) => s + fc.monthlyCost, 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {fixedCosts.map((fc, i) => (
                <div key={i} className="flex items-center justify-between py-1">
                  <span className="text-sm">{fc.name}</span>
                  <span className="text-sm font-medium">${fc.monthlyCost.toLocaleString("en-US", { minimumFractionDigits: 2 })} /mo</span>
                </div>
              ))}
              {fixedCosts.length === 0 && (
                <div className="py-4 text-center text-zinc-400 text-sm">No fixed costs configured.</div>
              )}
              <div className="border-t border-zinc-200 pt-2 mt-2">
                <div className="flex justify-between text-sm font-semibold">
                  <span>Monthly Total</span>
                  <span>${fixedCosts.reduce((s, fc) => s + fc.monthlyCost, 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Loading state for refreshes */}
        {loading && (
          <div className="fixed inset-0 bg-black/5 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 shadow-lg flex items-center gap-3">
              <div className="w-5 h-5 border-2 border-zinc-900 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm font-medium">Refreshing...</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
