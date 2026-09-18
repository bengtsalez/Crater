export function formatSum(sum: number | null | undefined | ''): string {
  if (sum === null || sum === undefined || sum === '') return '–'
  return new Intl.NumberFormat('sv-SE').format(sum) + ' kr'
}

export function taskCountLabel(n: number): string {
  return `${n} uppgift${n === 1 ? '' : 'er'}`
}

export type ActivityDayBucket = 'today' | 'yesterday' | 'this_week' | 'older'

const BUCKET_LABELS: Record<ActivityDayBucket, string> = {
  today: 'Idag',
  yesterday: 'Igår',
  this_week: 'Denna vecka',
  older: 'Äldre',
}

function startOfDay(dt: Date): Date {
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate())
}

function dayBucket(iso: string): ActivityDayBucket {
  const diffDays = Math.floor((startOfDay(new Date()).getTime() - startOfDay(new Date(iso)).getTime()) / 86400000)
  if (diffDays <= 0) return 'today'
  if (diffDays === 1) return 'yesterday'
  if (diffDays <= 7) return 'this_week'
  return 'older'
}

export interface ActivityGroup<T> {
  bucket: ActivityDayBucket
  label: string
  items: T[]
}

// Grupperar en redan nyast-först-sorterad lista i Idag/Igår/Denna vecka/Äldre,
// bara för de hinkar som faktiskt har innehåll (ingen tom "Äldre"-rubrik).
export function groupActivitiesByDay<T extends { created_at: string }>(items: T[]): ActivityGroup<T>[] {
  const order: ActivityDayBucket[] = ['today', 'yesterday', 'this_week', 'older']
  const buckets = new Map<ActivityDayBucket, T[]>()
  for (const item of items) {
    const bucket = dayBucket(item.created_at)
    if (!buckets.has(bucket)) buckets.set(bucket, [])
    buckets.get(bucket)!.push(item)
  }
  return order.filter((b) => buckets.has(b)).map((b) => ({ bucket: b, label: BUCKET_LABELS[b], items: buckets.get(b)! }))
}

export function formatActivityTime(iso: string): string {
  const d = new Date(iso)
  return dayBucket(iso) === 'today'
    ? d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })
}
