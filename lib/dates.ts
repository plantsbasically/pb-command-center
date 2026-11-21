/**
 * America/Los_Angeles calendar helpers.
 *
 * Never use `toISOString().slice(0,10)` / `new Date()` local-day math for
 * business dates — Railway runs UTC, so late afternoon PT rolls to the next
 * UTC day and labels/queries go wrong.
 */

export const PACIFIC_TZ = "America/Los_Angeles"

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Format an instant as YYYY-MM-DD in the given IANA time zone (default PT). */
export function formatDateInTimeZone(
  date: Date,
  timeZone: string = PACIFIC_TZ
): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

/** Today's calendar date in America/Los_Angeles. */
export function todayPacific(now: Date = new Date()): string {
  return formatDateInTimeZone(now, PACIFIC_TZ)
}

/** Yesterday's calendar date in America/Los_Angeles. */
export function yesterdayPacific(now: Date = new Date()): string {
  return addDaysISO(todayPacific(now), -1)
}

/** Dashboard preset: Pacific today as a single-day range. */
export function todayDateRange(now: Date = new Date()): { start: string; end: string } {
  const day = todayPacific(now)
  return { start: day, end: day }
}

/** Dashboard preset: Pacific yesterday as a single-day range. */
export function yesterdayDateRange(now: Date = new Date()): { start: string; end: string } {
  const day = yesterdayPacific(now)
  return { start: day, end: day }
}

/** Current hour (0–23) in America/Los_Angeles. */
export function pacificHour(now: Date = new Date()): number {
  const hourStr = new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC_TZ,
    hour: "numeric",
    hourCycle: "h23",
  }).format(now)
  return Number(hourStr)
}

/**
 * Triple Whale `todayHour`: Pacific wall-clock hour + 1, clamped to [1, 25].
 * Must NOT use UTC `Date#getHours()` on Railway.
 */
export function tripleWhaleTodayHour(now: Date = new Date()): number {
  return Math.min(25, Math.max(1, pacificHour(now) + 1))
}

/** Parse YYYY-MM-DD → {y,m,d} (m is 1–12). */
export function parseISODate(isoDate: string): { y: number; m: number; d: number } {
  if (!DATE_RE.test(isoDate)) {
    throw new Error(`Invalid ISO date: ${isoDate}`)
  }
  const [y, m, d] = isoDate.split("-").map(Number)
  return { y, m, d }
}

/** Add calendar days to a YYYY-MM-DD string (UTC-date arithmetic; no TZ drift). */
export function addDaysISO(isoDate: string, days: number): string {
  const { y, m, d } = parseISODate(isoDate)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

/** Inclusive list of YYYY-MM-DD from start→end (calendar days). */
export function eachDateInclusive(start: string, end: string): string[] {
  if (start > end) return []
  const out: string[] = []
  let cur = start
  while (cur <= end) {
    out.push(cur)
    cur = addDaysISO(cur, 1)
  }
  return out
}

/** Number of inclusive calendar days in [start, end]. */
export function daysInclusive(start: string, end: string): number {
  const a = parseISODate(start)
  const b = parseISODate(end)
  const ms =
    Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)
  return Math.max(1, Math.round(ms / 86400000) + 1)
}

/**
 * Offset of `timeZone` at a given instant, as minutes east of UTC
 * (e.g. Pacific standard ≈ -480).
 */
export function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
  const parts = Object.fromEntries(
    dtf
      .formatToParts(date)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value])
  ) as Record<string, string>
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  )
  return (asUTC - date.getTime()) / 60000
}

/** Format offset minutes as ±HH:MM. */
export function formatOffsetMinutes(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? "+" : "-"
  const abs = Math.abs(offsetMinutes)
  const hh = String(Math.floor(abs / 60)).padStart(2, "0")
  const mm = String(abs % 60).padStart(2, "0")
  return `${sign}${hh}:${mm}`
}

/**
 * UTC instant of local midnight on `isoDate` in `timeZone`.
 * Iterates once or twice so DST transitions resolve correctly.
 */
export function zonedMidnightUTC(
  isoDate: string,
  timeZone: string = PACIFIC_TZ
): Date {
  const { y, m, d } = parseISODate(isoDate)
  // First guess: treat calendar date as UTC midnight, then correct by offset.
  let guess = Date.UTC(y, m - 1, d)
  for (let i = 0; i < 3; i++) {
    const offsetMin = getTimeZoneOffsetMinutes(new Date(guess), timeZone)
    guess = Date.UTC(y, m - 1, d) - offsetMin * 60_000
  }
  return new Date(guess)
}

/**
 * Pacific offset string (±HH:MM) that applies at local midnight on `isoDate`.
 * Safe for start-of-day and end-of-day wall times (DST flips at 2am PT).
 */
export function pacificOffsetAtDate(isoDate: string): string {
  const midnight = zonedMidnightUTC(isoDate, PACIFIC_TZ)
  return formatOffsetMinutes(getTimeZoneOffsetMinutes(midnight, PACIFIC_TZ))
}

/**
 * Shopify Admin `created_at_min` / `created_at_max` for a Pacific calendar day.
 * Shopify treats bare `YYYY-MM-DDTHH:mm:ss` (no offset) as **UTC**, so we must
 * include the Pacific offset (DST-aware).
 */
export function shopifyCreatedAtBounds(dateStart: string, dateEnd: string): {
  createdAtMin: string
  createdAtMax: string
} {
  const startOffset = pacificOffsetAtDate(dateStart)
  const endOffset = pacificOffsetAtDate(dateEnd)
  return {
    createdAtMin: `${dateStart}T00:00:00${startOffset}`,
    createdAtMax: `${dateEnd}T23:59:59${endOffset}`,
  }
}

/**
 * Instant bounds for a Pacific calendar day (for comparing customer.created_at).
 * End is inclusive through 23:59:59.999 PT.
 */
export function pacificDayInstantBounds(isoDate: string): {
  start: Date
  end: Date
} {
  const start = zonedMidnightUTC(isoDate, PACIFIC_TZ)
  const end = new Date(zonedMidnightUTC(addDaysISO(isoDate, 1), PACIFIC_TZ).getTime() - 1)
  return { start, end }
}

/** First calendar day of the Pacific month containing `isoDate` (or today). */
export function startOfPacificMonth(isoDate?: string): string {
  const day = isoDate || todayPacific()
  return `${day.slice(0, 7)}-01`
}

/** Last calendar day of the Pacific month containing `isoDate`. */
export function endOfPacificMonth(isoDate: string): string {
  const { y, m } = parseISODate(isoDate)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`
}

/** Previous Pacific calendar month as { start, end }. */
export function previousPacificMonth(now: Date = new Date()): {
  start: string
  end: string
} {
  const today = todayPacific(now)
  const thisMonthStart = startOfPacificMonth(today)
  const lastDayPrev = addDaysISO(thisMonthStart, -1)
  return {
    start: startOfPacificMonth(lastDayPrev),
    end: lastDayPrev,
  }
}

/** Common dashboard presets using Pacific calendar days. */
export function pacificDatePresets(now: Date = new Date()): Record<
  string,
  { start: string; end: string }
> {
  const end = todayPacific(now)
  return {
    "Last 7d": { start: addDaysISO(end, -7), end },
    "Last 30d": { start: addDaysISO(end, -30), end },
    "Last 90d": { start: addDaysISO(end, -90), end },
    "Last 180d": { start: addDaysISO(end, -180), end },
    "Month to Date": { start: startOfPacificMonth(end), end },
    "Last Month": previousPacificMonth(now),
  }
}

/** DATE column from node-postgres may arrive as Date — normalize to YYYY-MM-DD without UTC shift. */
export function pgDateToISO(value: Date | string): string {
  if (typeof value === "string") {
    return value.slice(0, 10)
  }
  // postgres.js returns Date at UTC midnight for DATE columns
  return value.toISOString().slice(0, 10)
}
