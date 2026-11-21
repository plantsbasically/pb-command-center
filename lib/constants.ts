import { pacificDatePresets, todayPacific, startOfPacificMonth } from "./dates"

export const USERS = [
  { username: "pb", password: "profit123" },
] as const

export const DEFAULT_DATE_RANGE = {
  start: startOfPacificMonth(),
  end: todayPacific(),
}

export { TARGET_LTV_CAC, LTV_CAC_WARNING } from "./ltv-cac"

/** Re-export Pacific presets for server callers; client page uses pacificDatePresets directly. */
export function getDefaultPacificPresets() {
  return pacificDatePresets()
}
