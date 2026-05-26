import fs from "fs"
import path from "path"

const DATA_DIR = path.join(process.cwd(), "data")

export function readJSON<T>(filename: string): T {
  const filePath = path.join(DATA_DIR, filename)
  if (!fs.existsSync(filePath)) {
    return null as unknown as T
  }
  const raw = fs.readFileSync(filePath, "utf-8")
  return JSON.parse(raw) as T
}

export function writeJSON(filename: string, data: any): void {
  const filePath = path.join(DATA_DIR, filename)
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8")
}
