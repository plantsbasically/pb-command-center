"use client"
import { useState, useEffect, useCallback } from "react"

interface Metrics {
  revenue: number
  shopifyRevenue: number
  amazonRevenue: number
  cogs: number
  shopifyCOGS: number
  amazonCOGS: number
  grossProfit: number
  grossMarginPct: number
  shippingCollected: number
  fulfillmentInvoiceTotal: number
  netFulfillmentCost: number
  amazonFeeInvoiceTotal: number
  adSpend: number
  contributionProfit: number
  contributionMarginPct: number
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

const PRESETS = {
  "Last 7d": () => {
    const end = new Date()
    const start = new Date(end)
    start.setDate(start.getDate() - 7)
    return { start: start.toISOString().split("T")[0], end: end.toISOString().split("T")[0] }
  },
  "Last 30d": () => {
    const end = new Date()
    const start = new Date(end)
    start.setDate(start.getDate() - 30)
    return { start: start.toISOString().split("T")[0], end: end.toISOString().split("T")[0] }
  },
  "Last 90d": () => {
    const end = new Date()
    const start = new Date(end)
    start.setDate(start.getDate() - 90)
    return { start: start.toISOString().split("T")[0], end: end.toISOString().split("T")[0] }
  },
  "Last 180d": () => {
    const end = new Date()
    const start = new Date(end)
    start.setDate(start.getDate() - 180)
    return { start: start.toISOString().split("T")[0], end: end.toISOString().split("T")[0] }
  },
  "Month to Date": () => {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    return { start: start.toISOString().split("T")[0], end: now.toISOString().split("T")[0] }
  },
  "Last Month": () => {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const end = new Date(now.getFullYear(), now.getMonth(), 0)
    return { start: start.toISOString().split("T")[0], end: end.toISOString().split("T")[0] }
  },
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

export default function Dashboard() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [variants, setVariants] = useState<COGSVariant[]>([])
  const [fixedCosts, setFixedCosts] = useState<FixedCostLine[]>([])
  const [cogsBreakdown, setCogsBreakdown] = useState<COGSBreakdown[]>([])
  const [twData, setTwData] = useState<TWData | null>(null)
  const [dateStart, setDateStart] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0]
  })
  const [dateEnd, setDateEnd] = useState(() => new Date().toISOString().split("T")[0])
  const [editingCOGS, setEditingCOGS] = useState(false)
  const [editingFixed, setEditingFixed] = useState(false)
  const [localVariants, setLocalVariants] = useState<COGSVariant[]>([])
  const [localFixed, setLocalFixed] = useState<FixedCostLine[]>([])
  const [newFixedName, setNewFixedName] = useState("")
  const [newFixedCost, setNewFixedCost] = useState("")
  const [syncing, setSyncing] = useState(false)
  const [fulfillmentInvoices, setFulfillmentInvoices] = useState<FulfillmentInvoice[]>([])
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
      setTwData(json.twData || null)
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
            label: newInvoiceLabel.trim() || "Nice Commerce Invoice",
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

        {/* Revenue by Channel */}
        <div className="grid grid-cols-3 gap-4">
          {[
            {
              label: "Total Blended Revenue",
              value: fmt(m?.revenue || 0),
              sub: null,
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
          ].map((card) => (
            <div key={card.label} className="card">
              <div className="metric-big">{card.value}</div>
              {card.sub && <div className="text-xs text-zinc-400 mt-0.5">{card.sub}</div>}
              <div className="metric-label mt-1">{card.label}</div>
            </div>
          ))}
        </div>

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

        {/* Row 1 — P&L Waterfall */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {[
            {
              label: "COGS",
              value: fmt(m?.cogs || 0),
              pct: null,
              cls: "text-red-600",
              hint: m && m.amazonCOGS > 0
                ? `Shopify ${fmt(m.shopifyCOGS)} + Amazon ~${fmt(m.amazonCOGS)} est.`
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
              label: "Fulfillment Net",
              value: m && m.fulfillmentInvoiceTotal > 0 ? fmt(m.netFulfillmentCost) : "—",
              pct: null,
              cls: m && m.fulfillmentInvoiceTotal > 0 ? (m.netFulfillmentCost <= 0 ? "positive" : "text-orange-600") : "text-zinc-400",
              hint: m && m.fulfillmentInvoiceTotal > 0
                ? `3PL ${fmt(m.fulfillmentInvoiceTotal)} − shipping collected ${fmt(m.shippingCollected)}`
                : "Add a Nice Commerce invoice below",
            },
            {
              label: "Amazon Fees",
              value: m && m.amazonFeeInvoiceTotal > 0 ? fmt(m.amazonFeeInvoiceTotal) : "—",
              pct: null,
              cls: m && m.amazonFeeInvoiceTotal > 0 ? "text-orange-600" : "text-zinc-400",
              hint: "FBA handling fees · sourced from Triple Whale",
            },
            {
              label: "Contribution Profit",
              value: fmt(m?.contributionProfit || 0),
              pct: fmtPct(m?.contributionMarginPct || 0),
              cls: m ? (m.contributionProfit >= 0 ? "positive" : "negative") : "",
              hint: "after product cost, fulfillment, Amazon fees & ad spend",
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

        {/* Fulfillment — 3PL invoices vs. shipping collected */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold text-base">Fulfillment</h2>
              <p className="text-xs text-zinc-400 mt-0.5">Nice Commerce invoices vs. shipping collected from customers</p>
            </div>
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
              <div className="text-xs text-zinc-400 mt-0.5">3PL invoice (prorated to period)</div>
            </div>
            <div className={`rounded-lg p-3 ${m && m.fulfillmentInvoiceTotal > 0 ? (m.netFulfillmentCost <= 0 ? "bg-green-50" : "bg-orange-50") : "bg-zinc-50"}`}>
              <div className={`text-sm font-semibold ${m && m.fulfillmentInvoiceTotal > 0 ? (m.netFulfillmentCost <= 0 ? "text-green-700" : "text-orange-700") : "text-zinc-400"}`}>
                {m && m.fulfillmentInvoiceTotal > 0 ? fmt(m.netFulfillmentCost) : "—"}
              </div>
              <div className="text-xs text-zinc-400 mt-0.5">Net fulfillment cost</div>
            </div>
          </div>

          {/* Invoice list */}
          {fulfillmentInvoices.length > 0 && (
            <div className="mb-4">
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
                      <td className="py-2.5 px-2 text-sm">{inv.label || "Nice Commerce Invoice"}</td>
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
            <div className="text-xs font-medium text-zinc-500 uppercase mb-3">Add Nice Commerce Invoice</div>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <input
                value={newInvoiceLabel}
                onChange={(e) => setNewInvoiceLabel(e.target.value)}
                placeholder="Nice Commerce — May 2025"
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
