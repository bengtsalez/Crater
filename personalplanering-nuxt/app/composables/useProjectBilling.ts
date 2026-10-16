import type { ProjectBillingView } from '../../shared/billingTypes'
import type { PriceMode } from '../utils/billingDraft'

const PRICE_MODE_KEY = 'crater:billing:priceMode'

/**
 * Faktureringsvyn för det öppna projektet. Alla mutationer returnerar den
 * uppdaterade vyn från servern (som räknar om allt), så klienten håller aldrig
 * egna belopp utanför pågående redigering.
 */
export function useProjectBilling() {
  const view = useState<ProjectBillingView | null>('billing:view', () => null)
  const loading = useState('billing:loading', () => false)
  const priceMode = useState<PriceMode>('billing:priceMode', () => {
    try {
      return (import.meta.client && localStorage.getItem(PRICE_MODE_KEY) === 'inc') ? 'inc' : 'ex'
    } catch {
      return 'ex'
    }
  })
  const { api } = useApi()
  const { refresh: refreshActivity } = useProjectActivity()

  watch(priceMode, (m) => {
    try {
      localStorage.setItem(PRICE_MODE_KEY, m)
    } catch {
      /* per-användare-bekvämlighet – ignoreras om lagring saknas */
    }
  })

  async function load(projectId: number) {
    loading.value = true
    try {
      view.value = await api<ProjectBillingView>('GET', `/api/projects/${projectId}/billing`)
    } finally {
      loading.value = false
    }
  }

  /** Kör en mutation som svarar med vyn (direkt eller under `view`). */
  async function mutate<T = unknown>(method: 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown): Promise<T> {
    const res = await api<any>(method, url, body)
    if (res && 'calc' in res) view.value = res as ProjectBillingView
    else if (res?.view) view.value = res.view as ProjectBillingView
    refreshActivity().catch(() => {})
    return res as T
  }

  async function downloadPdf(url: string, fallbackName: string) {
    const res = await ($fetch.raw as any)(url, { responseType: 'blob' }).catch((err: unknown) => {
      throw new Error(errorMessage(err, 'Kunde inte skapa PDF.'))
    })
    const cd: string = res.headers.get('content-disposition') || ''
    const name = /filename="([^"]+)"/.exec(cd)?.[1] || fallbackName
    const href = URL.createObjectURL(res._data as Blob)
    const a = document.createElement('a')
    a.href = href
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(href), 10000)
  }

  return { view, loading, priceMode, load, mutate, downloadPdf }
}
