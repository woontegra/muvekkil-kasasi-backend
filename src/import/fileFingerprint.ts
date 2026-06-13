import { createHash } from 'node:crypto'
import fs from 'node:fs'

export function sha256File(filePath: string): string {
  const buf = fs.readFileSync(filePath)
  return createHash('sha256').update(buf).digest('hex')
}
