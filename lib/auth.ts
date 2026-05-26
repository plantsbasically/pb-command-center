import { USERS } from "./constants"

export function verifyAuth(username: string, password: string): boolean {
  return USERS.some(
    (u) => u.username === username && u.password === password
  )
}

export function getBasicAuthHeader(header: string | null) {
  if (!header) return null
  const base64 = header.split(" ")[1]
  if (!base64) return null
  try {
    const decoded = Buffer.from(base64, "base64").toString("utf-8")
    const [username, password] = decoded.split(":")
    return { username, password, valid: verifyAuth(username, password) }
  } catch {
    return null
  }
}

export function authHeaders(): HeadersInit {
  return {
    "WWW-Authenticate": 'Basic realm="Profit Command Center"',
  }
}
