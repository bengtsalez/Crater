export const WORK_TYPES = ['project', 'small_job']
export const BILLING_TYPES = ['billable', 'warranty', 'internal']

// Arbetsplatsens adress (fri text, t.ex. "Storgatan 1, 211 22 Malmö"). Tomt → null.
export function normalizeSiteAddress(v: unknown): string | null {
  const s = String(v ?? '').trim()
  return s ? s.slice(0, 300) : null
}
