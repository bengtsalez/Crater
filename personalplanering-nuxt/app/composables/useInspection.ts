import type { AnswerValue } from '../../shared/inspections'
import type { InspectionItemView, InspectionView } from '../../shared/inspectionTypes'
import { ImagePrepError, prepareImageForUpload } from '~/utils/inspectionImage'

export type ItemSaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict'

/**
 * En öppen kontroll (intern vy eller personalvy – `base` är API-prefixet).
 * Sparstatus visas per punkt och "Sparad" först när servern bekräftat.
 * Konflikt (409 'conflict') = någon annan har sparat punkten sedan vyn
 * laddades – inget skrivs över; användaren får ladda om.
 */
export function useInspection(base: () => string) {
  const { api } = useApi()
  const view = ref<InspectionView | null>(null)
  const pending = ref(true)
  const loadError = ref('')
  const notFound = ref(false)
  const busy = ref(false)
  const itemState = reactive<Record<number, { state: ItemSaveState; message?: string }>>({})
  const uploading = reactive<Record<string, number>>({})

  async function load() {
    for (const k of Object.keys(itemState)) delete itemState[Number(k)]
    try {
      view.value = await api<InspectionView>('GET', base())
      loadError.value = ''
      notFound.value = false
    } catch (err) {
      const e = err as ApiError
      if (e?.status === 404) notFound.value = true
      else loadError.value = e?.message || 'Kunde inte hämta kontrollen.'
    } finally {
      pending.value = false
    }
  }

  // Sparningar per punkt köas: blur + klick på "Spara" får inte skicka två
  // anrop med samma revision (det andra hade gett en falsk konflikt). Varje
  // anrop använder revisionen från serverns senaste svar.
  const queue = new Map<number, Promise<boolean>>()
  function saveAnswer(item: InspectionItemView, value: Partial<AnswerValue>): Promise<boolean> {
    const next = (queue.get(item.id) ?? Promise.resolve(true)).then(() => doSave(item.id, value))
    queue.set(item.id, next)
    return next
  }

  async function doSave(itemId: number, value: Partial<AnswerValue>): Promise<boolean> {
    const current = view.value?.items.find((i) => i.id === itemId)
    if (!current) return false
    if (itemState[itemId]?.state === 'conflict') return false
    const a = current.answer
    const same =
      !!a &&
      (Object.keys(value) as (keyof AnswerValue)[]).every((k) => normalizeForCompare(k, value[k]) === normalizeForCompare(k, a[k]))
    if (same) return true
    itemState[itemId] = { state: 'saving' }
    try {
      view.value = await api<InspectionView>('PUT', `${base()}/answers/${itemId}`, { ...value, rev: current.rev })
      itemState[itemId] = { state: 'saved' }
      return true
    } catch (err) {
      const e = err as ApiError
      itemState[itemId] = { state: e?.code === 'conflict' ? 'conflict' : 'error', message: e?.message || 'Kunde inte spara.' }
      return false
    }
  }

  function uploadKey(target: { item_id?: number; deviation_id?: number }) {
    return target.item_id ? `i${target.item_id}` : `d${target.deviation_id}`
  }

  /** Förbered → begär signerad URL → ladda upp direkt → bekräfta. Returnerar felmeddelande eller null. */
  async function uploadPhoto(target: { item_id?: number; deviation_id?: number }, file: File): Promise<string | null> {
    const key = uploadKey(target)
    uploading[key] = (uploading[key] ?? 0) + 1
    try {
      const blob = await prepareImageForUpload(file)
      const up = await api<{ id: string; upload_url: string; headers: Record<string, string> }>('POST', `${base()}/attachments`, {
        ...target,
        content_type: blob.type || 'image/jpeg',
        byte_size: blob.size,
      })
      const put = await fetch(up.upload_url, { method: 'PUT', headers: up.headers, body: blob }).catch(() => null)
      if (!put || !put.ok) throw new Error('Uppladdningen till bildlagringen misslyckades. Kontrollera anslutningen och försök igen.')
      view.value = await api<InspectionView>('POST', `${base()}/attachments/${up.id}/confirm`)
      return null
    } catch (err) {
      if (err instanceof ImagePrepError) return err.message
      return (err as Error)?.message || 'Kunde inte ladda upp bilden.'
    } finally {
      uploading[key] = (uploading[key] ?? 1) - 1
    }
  }

  async function removePhoto(id: string): Promise<string | null> {
    try {
      view.value = await api<InspectionView>('DELETE', `${base()}/attachments/${id}`)
      return null
    } catch (err) {
      return (err as Error).message
    }
  }

  /** Generell mutation som returnerar den uppdaterade vyn. Kastar ApiError. */
  async function mutate(method: 'POST' | 'PUT', path: string, body?: unknown) {
    busy.value = true
    try {
      const res = await api<InspectionView | { view: InspectionView }>(method, `${base()}${path}`, body)
      view.value = 'view' in res && res.view ? res.view : (res as InspectionView)
      return res
    } finally {
      busy.value = false
    }
  }

  async function downloadPdf() {
    const res = await ($fetch.raw as any)(`${base()}/pdf`, { responseType: 'blob' }).catch((err: unknown) => {
      throw new Error(errorMessage(err, 'Kunde inte skapa PDF.'))
    })
    saveBlob(res, 'egenkontroll.pdf')
  }

  return { view, pending, loadError, notFound, busy, itemState, uploading, uploadKey, load, saveAnswer, uploadPhoto, removePhoto, mutate, downloadPdf }
}

function normalizeForCompare(k: keyof AnswerValue, v: unknown): string {
  if (v === undefined || v === null || v === '') return ''
  if (k === 'number_value') return String(v).replace(/\s/g, '').replace(',', '.').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
  return String(v).trim()
}

export function saveBlob(res: { headers: Headers; _data: unknown }, fallbackName: string) {
  const cd = res.headers.get('content-disposition') || ''
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
