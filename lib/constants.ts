export const USERS = [
  { username: "pb", password: "profit123" },
] as const

export const DEFAULT_DATE_RANGE = {
  start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0],
  end: new Date().toISOString().split("T")[0],
}

export const TARGET_LTV_CAC = 3.0
