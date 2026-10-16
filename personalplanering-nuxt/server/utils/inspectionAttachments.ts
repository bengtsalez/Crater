// Egenkontroller – bilder: begär uppladdning, bekräfta, hämta och ta bort.
//
// Nitro-fri (testas med PGlite + minneslagring). Flöde:
//  1. requestUpload: behörighet + deklarerad typ/storlek/antal → rad 'pending'
//     och en kortlivad signerad PUT-URL. Nyckeln genereras av servern.
//  2. Klienten laddar upp direkt till lagringen (inte via serverless-anropet).
//  3. confirmUpload: servern läser objektets faktiska storlek och första byte
//     (magiska tal) – fel typ/storlek → 'rejected' och objektet raderas.
//     Först nu räknas bilden mot punktens fotokrav.
//  4. attachmentUrl: behörighet → kortlivad signerad GET-URL.
// Bilder i låsta (inlämnade/godkända/arkiverade) kontroller kan inte tas bort.

import { randomUUID } from 'node:crypto'
import { IMAGE_TYPES, isAnswerable, MAX_IMAGE_BYTES, MAX_IMAGES_PER_TARGET } from '../../shared/inspections'
import { InspectionError, inspId, loadInspectionRow, type InspectionActor, type InspectionDb, type InspQueryable } from './inspectionCore'
import type { InspectionStorage } from './inspectionStorage'
import { sniffImage, SNIFF_BYTES } from './inspectionImages'

export const UPLOAD_URL_TTL_SEC = 300
export const DOWNLOAD_URL_TTL_SEC = 60
const MB = (MAX_IMAGE_BYTES / 1024 / 1024).toFixed(0)

function requireStorage(storage: InspectionStorage) {
  if (!storage.configured) {
    throw new InspectionError(
      503,
      'Bildlagring är inte konfigurerad – bilder kan inte laddas upp. Kontakta administratören.',
      'storage_not_configured'
    )
  }
}

/** Kan mål (punkt eller avvikelse) ta emot/släppa bilder i kontrollens nuvarande läge? */
async function loadTarget(q: InspQueryable, actor: InspectionActor, row: any, target: { item_id?: unknown; deviation_id?: unknown }) {
  if (row.superseded_by_id !== null) throw new InspectionError(409, 'Kontrollen har ersatts av en nyare revision.', 'superseded')
  const itemId = target.item_id !== undefined && target.item_id !== null ? inspId(target.item_id) : null
  const devId = target.deviation_id !== undefined && target.deviation_id !== null ? inspId(target.deviation_id) : null
  if ((itemId === null) === (devId === null)) throw new InspectionError(400, 'Ange antingen kontrollpunkt eller avvikelse.')
  if (itemId) {
    const it = (await q.query('SELECT id FROM inspection_items WHERE id = $1 AND inspection_id = $2 AND org_id = $3', [itemId, row.id, actor.orgId])).rows[0]
    if (!it) throw new InspectionError(404, 'Kontrollpunkten hittades inte.')
    if (!isAnswerable(row.status)) {
      throw new InspectionError(409, 'Kontrollen är låst – bilder kan inte läggas till eller tas bort.', 'locked')
    }
    return { column: 'item_id' as const, id: itemId }
  }
  const dev = (await q.query('SELECT id, status FROM inspection_deviations WHERE id = $1 AND inspection_id = $2 AND org_id = $3', [devId, row.id, actor.orgId])).rows[0]
  if (!dev) throw new InspectionError(404, 'Avvikelsen hittades inte.')
  if (row.status === 'approved' || row.status === 'archived' || dev.status === 'verified') {
    throw new InspectionError(409, 'Avvikelsen är låst – bilder kan inte läggas till eller tas bort.', 'locked')
  }
  return { column: 'deviation_id' as const, id: devId! }
}

export async function requestUpload(
  db: InspectionDb,
  actor: InspectionActor,
  storage: InspectionStorage,
  inspectionId: unknown,
  input: { item_id?: unknown; deviation_id?: unknown; content_type?: unknown; byte_size?: unknown }
): Promise<{ id: string; upload_url: string; headers: Record<string, string>; expires_in: number }> {
  requireStorage(storage)
  if (typeof input.content_type !== 'string' || !(IMAGE_TYPES as readonly string[]).includes(input.content_type)) {
    throw new InspectionError(400, 'Filformatet stöds inte. Använd JPEG, PNG eller WebP.', 'unsupported_type')
  }
  const size = Number(input.byte_size)
  if (!Number.isInteger(size) || size <= 0) throw new InspectionError(400, 'Ogiltig filstorlek.')
  if (size > MAX_IMAGE_BYTES) throw new InspectionError(400, `Bilden är för stor (högst ${MB} MB).`, 'too_large')
  const contentType = input.content_type
  const id = randomUUID()
  const key = await db.tx(async (q) => {
    const row = await loadInspectionRow(q, actor, inspectionId, { forUpdate: true })
    const target = await loadTarget(q, actor, row, input)
    const { rows } = await q.query(
      `SELECT count(*)::int AS n FROM inspection_attachments
       WHERE ${target.column} = $1 AND (status = 'confirmed' OR (status = 'pending' AND created_at > now() - interval '1 hour'))`,
      [target.id]
    )
    if (rows[0].n >= MAX_IMAGES_PER_TARGET) throw new InspectionError(400, `Högst ${MAX_IMAGES_PER_TARGET} bilder per punkt.`, 'too_many')
    const storageKey = `org/${actor.orgId}/inspections/${row.id}/${id}`
    await q.query(
      `INSERT INTO inspection_attachments (id, org_id, project_id, inspection_id, ${target.column}, storage_key, content_type, byte_size,
         status, uploaded_by_user_id, uploaded_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10)`,
      [id, actor.orgId, row.project_id, row.id, target.id, storageKey, contentType, size, actor.userId, actor.name]
    )
    return storageKey
  })
  return {
    id,
    upload_url: await storage.presignPut(key, contentType, UPLOAD_URL_TTL_SEC),
    headers: { 'Content-Type': contentType },
    expires_in: UPLOAD_URL_TTL_SEC,
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function loadAttachment(q: InspQueryable, actor: InspectionActor, row: any, attachmentId: unknown, forUpdate = false) {
  if (typeof attachmentId !== 'string' || !UUID_RE.test(attachmentId)) throw new InspectionError(404, 'Bilden hittades inte.')
  const att = (
    await q.query(
      `SELECT * FROM inspection_attachments WHERE id = $1 AND inspection_id = $2 AND org_id = $3${forUpdate ? ' FOR UPDATE' : ''}`,
      [attachmentId, row.id, actor.orgId]
    )
  ).rows[0]
  if (!att) throw new InspectionError(404, 'Bilden hittades inte.')
  return att
}

export async function confirmUpload(
  db: InspectionDb,
  actor: InspectionActor,
  storage: InspectionStorage,
  inspectionId: unknown,
  attachmentId: unknown
): Promise<void> {
  requireStorage(storage)
  // Läs utan lås först – lagringsanrop görs utanför transaktionen.
  const row0 = await loadInspectionRow(db, actor, inspectionId)
  const att0 = await loadAttachment(db, actor, row0, attachmentId)
  if (att0.status === 'confirmed') return
  if (att0.status !== 'pending') throw new InspectionError(409, 'Uppladdningen är inte längre giltig. Försök igen.', 'invalid_upload')

  const head = await storage.head(att0.storage_key)
  let reject: string | null = null
  let info = null
  if (!head) {
    throw new InspectionError(409, 'Filen har inte laddats upp ännu. Försök igen.', 'not_uploaded')
  } else if (head.size > MAX_IMAGE_BYTES) {
    reject = `Bilden är för stor (högst ${MB} MB).`
  } else {
    const bytes = await storage.getBytes(att0.storage_key, [0, Math.min(head.size, SNIFF_BYTES) - 1])
    info = bytes ? sniffImage(bytes) : null
    if (!info) reject = 'Filen är inte en giltig JPEG-, PNG- eller WebP-bild.'
  }

  await db.tx(async (q) => {
    const row = await loadInspectionRow(q, actor, inspectionId, { forUpdate: true })
    const att = await loadAttachment(q, actor, row, attachmentId, true)
    if (att.status !== 'pending') return
    if (reject) {
      await q.query("UPDATE inspection_attachments SET status = 'rejected', removed_at = now() WHERE id = $1", [att.id])
      return
    }
    // Läget kan ha ändrats under uppladdningen (t.ex. inlämnad).
    await loadTarget(q, actor, row, att.item_id ? { item_id: att.item_id } : { deviation_id: att.deviation_id })
    await q.query(
      `UPDATE inspection_attachments SET status = 'confirmed', confirmed_at = now(), content_type = $1, byte_size = $2,
         width = $3, height = $4, exif_orientation = $5 WHERE id = $6`,
      [info!.type, head!.size, info!.width, info!.height, info!.orientation, att.id]
    )
    await q.query('UPDATE inspections SET updated_at = now() WHERE id = $1', [row.id])
  })
  if (reject) {
    await storage.remove(att0.storage_key).catch(() => {})
    throw new InspectionError(400, reject, 'invalid_image')
  }
}

export async function attachmentUrl(
  db: InspectionDb,
  actor: InspectionActor,
  storage: InspectionStorage,
  inspectionId: unknown,
  attachmentId: unknown
): Promise<string> {
  requireStorage(storage)
  const row = await loadInspectionRow(db, actor, inspectionId)
  const att = await loadAttachment(db, actor, row, attachmentId)
  if (att.status !== 'confirmed') throw new InspectionError(404, 'Bilden hittades inte.')
  return storage.presignGet(att.storage_key, DOWNLOAD_URL_TTL_SEC)
}

export async function removeAttachment(
  db: InspectionDb,
  actor: InspectionActor,
  storage: InspectionStorage,
  inspectionId: unknown,
  attachmentId: unknown
): Promise<void> {
  const deleteKey = await db.tx(async (q) => {
    const row = await loadInspectionRow(q, actor, inspectionId, { forUpdate: true })
    const att = await loadAttachment(q, actor, row, attachmentId, true)
    if (att.status === 'removed' || att.status === 'rejected') return null
    await loadTarget(q, actor, row, att.item_id ? { item_id: att.item_id } : { deviation_id: att.deviation_id })
    await q.query("UPDATE inspection_attachments SET status = 'removed', removed_at = now() WHERE id = $1", [att.id])
    // Objektet raderas bara om ingen annan rad (t.ex. en låst tidigare revision) använder det.
    const { rows } = await q.query(
      "SELECT 1 FROM inspection_attachments WHERE storage_key = $1 AND id <> $2 AND status IN ('confirmed','pending') LIMIT 1",
      [att.storage_key, att.id]
    )
    return rows.length ? null : (att.storage_key as string)
  })
  if (deleteKey && storage.configured) await storage.remove(deleteKey).catch(() => {})
}

/** Hämtar bildbytes för PDF – bara egna lagringsnycklar, aldrig externa länkar. */
export function pdfImageLoader(storage: InspectionStorage) {
  return async (key: string) => (storage.configured ? storage.getBytes(key).catch(() => null) : null)
}
