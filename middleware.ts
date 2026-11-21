import { NextRequest, NextResponse } from "next/server"
import { USERS } from "@/lib/constants"

/**
 * Basic-auth gate for /api/* except Loop ingest endpoints (Bearer secret instead).
 * Route handlers still enforce their own auth as defense in depth.
 */
const LOOP_INGEST_EXEMPT = new Set([
  "/api/loop-metrics/ingest",
  "/api/loop-metrics/status",
])

function unauthorized() {
  return new NextResponse("Unauthorized", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Profit Command Center"' },
  })
}

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname

  if (LOOP_INGEST_EXEMPT.has(path)) {
    return NextResponse.next()
  }

  if (!path.startsWith("/api")) {
    return NextResponse.next()
  }

  const header = req.headers.get("authorization")
  if (!header?.startsWith("Basic ")) return unauthorized()
  try {
    const decoded = atob(header.slice(6))
    const sep = decoded.indexOf(":")
    if (sep < 0) return unauthorized()
    const username = decoded.slice(0, sep)
    const password = decoded.slice(sep + 1)
    if (USERS.some((u) => u.username === username && u.password === password)) {
      return NextResponse.next()
    }
  } catch {
    return unauthorized()
  }
  return unauthorized()
}

export const config = {
  matcher: ["/api/:path*"],
}
