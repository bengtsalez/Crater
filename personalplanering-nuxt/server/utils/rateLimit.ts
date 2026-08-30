// Enkel in-memory rate limit. Nollställs vid cold start – tillräckligt för en
// liten B2B-app tillsammans med honeypot + lösenordsregler på /api/signup.

interface Bucket {
  count: number
  reset: number
}

const buckets = new Map<string, Bucket>()

export function hitRateLimit(bucket: string, key: string, max: number, windowMs: number): boolean {
  const k = `${bucket}:${key}`
  const now = Date.now()
  const existing = buckets.get(k)

  if (!existing || existing.reset < now) {
    buckets.set(k, { count: 1, reset: now + windowMs })
    return true
  }
  if (existing.count >= max) return false
  existing.count++
  return true
}
