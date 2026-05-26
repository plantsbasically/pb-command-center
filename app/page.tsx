"use client"
import { useState, useEffect, useCallback } from "react"

interface Metrics {
  revenue: number
  cogs: number
  grossProfit: number
  grossMarginPct: number
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

interface COGSVariant {
  variantKey: string
  variantName: string
  shopifyVariantId: string
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

interface TWData {
  adSpend: number
  attributedRevenue: number
  blendedCac: number
  blendedRoas: number
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
        setVariants(json.data.variants)
        setEditingCOGS(false)
        fetchData()
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
      const res = await fetch("/api/admin", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "updateFixedCosts",
          data: { lineItems: localFixed },
        }),
      })
      const json = await res.json()
      if (json.ok) {
        setFixedCosts(json.data)
        setEditingFixed(false)
        fetchData()
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
    const newVariants = [...localVariants]
    newVariants[variantIdx].lineItems[lineIdx] = {
      ...newVariants[variantIdx].lineItems[lineIdx],
      [field]: field === "name" ? value : parseFloat(value) || 0,
    }
    // Recompute totalCost
    newVariants[variantIdx].totalCost = newVariants[variantIdx].lineItems.reduce(
      (s, i) => s + i.cost * i.quantity,
      0
    )
    setLocalVariants(newVariants)
  }

  const addVariantLineItem = (variantIdx: number) => {
    const newVariants = [...localVariants]
    newVariants[variantIdx].lineItems.push({ name: "New Item", cost: 0, quantity: 1 })
    setLocalVariants(newVariants)
  }

  const removeVariantLineItem = (variantIdx: number, lineIdx: number) => {
    const newVariants = [...localVariants]
    newVariants[variantIdx].lineItems.splice(lineIdx, 1)
    newVariants[variantIdx].totalCost = newVariants[variantIdx].lineItems.reduce(
      (s, i) => s + i.cost * i.quantity,
      0
    )
    setLocalVariants(newVariants)
  }

  const addVariant = () => {
    setLocalVariants([
      ...localVariants,
      {
        variantKey: `NEW-${Date.now()}`,
        variantName: "New Variant",
        shopifyVariantId: "",
        lineItems: [],
        totalCost: 0,
      },
    ])
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

        {/* Row 1 — P&L Waterfall */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {[
            { label: "Revenue", value: fmt(m?.revenue || 0), pct: null, cls: "", hint: null },
            { label: "COGS", value: fmt(m?.cogs || 0), pct: null, cls: "text-red-600", hint: null },
            {
              label: "Gross Profit",
              value: fmt(m?.grossProfit || 0),
              pct: fmtPct(m?.grossMarginPct || 0),
              cls: m && m.grossProfit >= 0 ? "positive" : "negative",
              hint: null,
            },
            {
              label: "Contribution Profit",
              value: fmt(m?.contributionProfit || 0),
              pct: fmtPct(m?.contributionMarginPct || 0),
              cls: m ? (m.contributionProfit >= 0 ? "positive" : "negative") : "",
              hint: "revenue left after product cost & ads — if negative, scaling loses money",
            },
            {
              label: "Net Profit",
              value: fmt(m?.netProfit || 0),
              pct: fmtPct(m?.netMarginPct || 0),
              cls: m && m.netProfit >= 0 ? "positive" : "negative",
              hint: null,
            },
            {
              label: "LTV:CAC",
              value: m ? m.ltvCacRatio.toFixed(2) + (isFinite(m.ltvCacRatio) ? "×" : "") : "—",
              pct: null,
              cls: ltvCacStatus,
              hint: null,
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
            { label: "Ad Spend", value: fmt(m?.adSpend || 0) },
            { label: "CAC", value: m ? fmt(m.cac) : "—" },
            { label: "LTV", value: m ? fmt(m.ltv) : "—" },
            { label: "AOV", value: m ? fmt(m.aov) : "—" },
          ].map((metric) => (
            <div key={metric.label} className="card">
              <div className="metric-big">{metric.value}</div>
              <div className="metric-label mt-1">{metric.label}</div>
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
              <button onClick={() => { setLocalVariants(JSON.parse(JSON.stringify(variants))); setEditingCOGS(true); }} className="btn-primary">
                Edit COGS
              </button>
            ) : (
              <div className="flex gap-2">
                <button onClick={saveCOGS} className="btn-primary">Save</button>
                <button onClick={() => setEditingCOGS(false)} className="btn-outline">Cancel</button>
              </div>
            )}
          </div>
          {editingCOGS ? (
            <div className="space-y-4">
              {localVariants.map((variant, vi) => (
                <div key={variant.variantKey + vi} className="border border-zinc-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex gap-2 items-center">
                      <input
                        value={variant.variantKey}
                        onChange={(e) => {
                          const nv = [...localVariants]
                          nv[vi].variantKey = e.target.value
                          setLocalVariants(nv)
                        }}
                        className="font-mono text-sm w-32"
                      />
                      <input
                        value={variant.variantName}
                        onChange={(e) => {
                          const nv = [...localVariants]
                          nv[vi].variantName = e.target.value
                          setLocalVariants(nv)
                        }}
                        className="text-sm flex-1"
                      />
                    </div>
                    <div className="text-sm font-semibold positive">${variant.totalCost.toFixed(2)} / unit</div>
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
                            <button onClick={() => removeVariantLineItem(vi, li)} className="text-zinc-400 hover:text-red-500">×</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button
                    onClick={() => addVariantLineItem(vi)}
                    className="mt-2 text-xs text-zinc-500 hover:text-zinc-900 flex items-center gap-1"
                  >
                    + Add line item
                  </button>
                </div>
              ))}
              <button onClick={addVariant} className="btn-outline text-xs">+ Add Variant</button>
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

        {/* Row 5 — Fixed Operating Costs */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-base">Fixed Operating Costs</h2>
            {!editingFixed ? (
              <button onClick={() => { setLocalFixed(JSON.parse(JSON.stringify(fixedCosts))); setEditingFixed(true); }} className="btn-primary">
                Edit Costs
              </button>
            ) : (
              <div className="flex gap-2">
                <button onClick={saveFixedCosts} className="btn-primary">Save</button>
                <button onClick={() => setEditingFixed(false)} className="btn-outline">Cancel</button>
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
                      const nl = [...localFixed]
                      nl[i].name = e.target.value
                      setLocalFixed(nl)
                    }}
                    className="flex-1"
                  />
                  <div className="text-zinc-500">$</div>
                  <input
                    type="number"
                    step="0.01"
                    value={fc.monthlyCost}
                    onChange={(e) => {
                      const nl = [...localFixed]
                      nl[i].monthlyCost = parseFloat(e.target.value) || 0
                      setLocalFixed(nl)
                    }}
                    className="w-28 text-right"
                  />
                  <button onClick={() => removeFixedCost(i)} className="text-zinc-400 hover:text-red-500">×</button>
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
                <button onClick={addFixedCost} className="text-zinc-500 hover:text-zinc-900 text-lg">+</button>
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
