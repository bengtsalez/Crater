import type { H3Event } from 'h3'
import { requireEmployee, requireInternal } from './auth'
import { apiError } from './http'
import { billingDb } from './billingHttp'
import { InspectionError, type InspectionActor, type InspectionDb } from './inspectionCore'
import { s3Storage, type InspectionStorage } from './inspectionStorage'
import { createInspections, createRevision, getInspection, getProjectInspections, listInspections, replaceInspectionItems, saveAnswer, updateInspectionMeta } from './inspectionRun'
import { transitionInspection } from './inspectionReview'
import { linkDeviationTask, listDeviations, reopenDeviation, resolveDeviation, updateDeviation, verifyDeviation } from './inspectionDeviations'
import { attachmentUrl, confirmUpload, pdfImageLoader, removeAttachment, requestUpload } from './inspectionAttachments'
import { exportInspectionPdf, exportProjectProtocol } from './inspectionExport'

// Route-lager för Egenkontroller. Varje route anger om den är intern
// (admin/member – requireInternal) eller för personal (requireEmployee, under
// /api/employee/** så att auth-middlewarens allow-list släpper igenom den).
// Identitet, roll, org och resurs kommer alltid från servern – aldrig klienten.
// Domänfunktionerna gör resten av behörighetskontrollen (inkl. bokning +
// uttrycklig tilldelning för personal) för varje läsning och skrivning.

type Mode = 'internal' | 'employee'

interface Ctx {
  event: H3Event
  db: InspectionDb
  actor: InspectionActor
  storage: InspectionStorage
}

let storageMemo: InspectionStorage | null = null
export function inspectionStorage(): InspectionStorage {
  return (storageMemo ??= s3Storage(process.env))
}

async function actorFor(event: H3Event, mode: Mode): Promise<InspectionActor> {
  if (mode === 'employee') {
    const emp = await requireEmployee(event)
    return { orgId: emp.org, userId: emp.userId, role: 'employee', name: emp.username, resourceId: emp.resourceId }
  }
  const user = requireInternal(event)
  if (user.role !== 'admin' && user.role !== 'member') throw apiError(403, 'Saknar behörighet.')
  return { orgId: user.org, userId: user.sub, role: user.role, name: user.username, resourceId: null }
}

function toHttpError(err: unknown): unknown {
  if (err instanceof InspectionError) {
    return createError({
      statusCode: err.status,
      message: err.message,
      data: { error: err.message, ...(err.code ? { code: err.code } : {}), ...(err.extra ?? {}) },
    })
  }
  const code = (err as { code?: string }).code
  if (code === '23505') return apiError(409, 'Uppgiften har redan registrerats (konflikt). Ladda om och försök igen.')
  // Triggers i databasen (låst kontroll / oföränderlig mallversion).
  if (code === 'P0001') return apiError(409, (err as Error).message || 'Kontrollen är låst.')
  return err
}

export function inspectionHandler<T>(mode: Mode, fn: (ctx: Ctx) => Promise<T>) {
  return defineEventHandler(async (event) => {
    const actor = await actorFor(event, mode)
    setHeader(event, 'Cache-Control', 'private, no-store')
    try {
      return await fn({ event, db: billingDb(), actor, storage: inspectionStorage() })
    } catch (err) {
      throw toHttpError(err)
    }
  })
}

const param = (event: H3Event, name: string) => getRouterParam(event, name)
const body = async (event: H3Event) => ((await readBody(event)) || {}) as Record<string, any>

async function sendPdf(event: H3Event, res: { bytes: Uint8Array; filename: string }) {
  setHeader(event, 'Content-Type', 'application/pdf')
  setHeader(event, 'Content-Disposition', `attachment; filename="${res.filename}"`)
  return Buffer.from(res.bytes)
}

const view = (c: Ctx, id: unknown) => getInspection(c.db, c.actor, id, c.storage.configured)

/** Gemensamma handlers – route-filerna väljer läge (intern/personal). */
export const inspectionRoutes = {
  list: (mode: Mode) =>
    inspectionHandler(mode, async (c) => {
      const q = getQuery(c.event)
      return listInspections(c.db, c.actor, {
        project_id: q.project_id === undefined ? undefined : q.project_id,
        status: q.status,
        responsible_user_id: q.responsible_user_id,
      })
    }),
  get: (mode: Mode) => inspectionHandler(mode, (c) => view(c, param(c.event, 'id'))),
  saveAnswer: (mode: Mode) =>
    inspectionHandler(mode, async (c) => {
      const id = param(c.event, 'id')
      await saveAnswer(c.db, c.actor, id, param(c.event, 'itemId'), await body(c.event))
      return view(c, id)
    }),
  transition: (mode: Mode, fixed?: 'submit') =>
    inspectionHandler(mode, async (c) => {
      const id = param(c.event, 'id')
      const b = await body(c.event)
      await transitionInspection(c.db, c.actor, id, fixed ?? b.action, { comment: b.comment, lock_version: b.lock_version })
      return view(c, id)
    }),
  pdf: (mode: Mode) =>
    inspectionHandler(mode, async (c) =>
      sendPdf(c.event, await exportInspectionPdf(c.db, c.actor, param(c.event, 'id'), { loadImage: pdfImageLoader(c.storage) }))
    ),
  requestUpload: (mode: Mode) =>
    inspectionHandler(mode, async (c) => {
      setResponseStatus(c.event, 201)
      return requestUpload(c.db, c.actor, c.storage, param(c.event, 'id'), await body(c.event))
    }),
  confirmUpload: (mode: Mode) =>
    inspectionHandler(mode, async (c) => {
      const id = param(c.event, 'id')
      await confirmUpload(c.db, c.actor, c.storage, id, param(c.event, 'attId'))
      return view(c, id)
    }),
  attachment: (mode: Mode) =>
    inspectionHandler(mode, async (c) => {
      const url = await attachmentUrl(c.db, c.actor, c.storage, param(c.event, 'id'), param(c.event, 'attId'))
      return sendRedirect(c.event, url, 302)
    }),
  removeAttachment: (mode: Mode) =>
    inspectionHandler(mode, async (c) => {
      const id = param(c.event, 'id')
      await removeAttachment(c.db, c.actor, c.storage, id, param(c.event, 'attId'))
      return view(c, id)
    }),
  updateDeviation: (mode: Mode) =>
    inspectionHandler(mode, async (c) => {
      const id = param(c.event, 'id')
      await updateDeviation(c.db, c.actor, id, param(c.event, 'devId'), await body(c.event))
      return view(c, id)
    }),
  resolveDeviation: (mode: Mode) =>
    inspectionHandler(mode, async (c) => {
      const id = param(c.event, 'id')
      await resolveDeviation(c.db, c.actor, id, param(c.event, 'devId'), await body(c.event))
      return view(c, id)
    }),

  // ---- Endast internt ----
  updateMeta: () =>
    inspectionHandler('internal', async (c) => {
      const id = param(c.event, 'id')
      await updateInspectionMeta(c.db, c.actor, id, await body(c.event))
      return view(c, id)
    }),
  replaceItems: () =>
    inspectionHandler('internal', async (c) => {
      const id = param(c.event, 'id')
      const b = await body(c.event)
      await replaceInspectionItems(c.db, c.actor, id, b.sections, b.lock_version)
      return view(c, id)
    }),
  revision: () =>
    inspectionHandler('internal', async (c) => {
      const b = await body(c.event)
      const newId = await createRevision(c.db, c.actor, param(c.event, 'id'), b)
      setResponseStatus(c.event, 201)
      return view(c, newId)
    }),
  verifyDeviation: () =>
    inspectionHandler('internal', async (c) => {
      const id = param(c.event, 'id')
      await verifyDeviation(c.db, c.actor, id, param(c.event, 'devId'), await body(c.event))
      return view(c, id)
    }),
  reopenDeviation: () =>
    inspectionHandler('internal', async (c) => {
      const id = param(c.event, 'id')
      await reopenDeviation(c.db, c.actor, id, param(c.event, 'devId'), await body(c.event))
      return view(c, id)
    }),
  deviationTask: () =>
    inspectionHandler('internal', async (c) => {
      const id = param(c.event, 'id')
      const res = await linkDeviationTask(c.db, c.actor, id, param(c.event, 'devId'))
      return { ...res, view: await view(c, id) }
    }),
  deviationList: () =>
    inspectionHandler('internal', async (c) => {
      const q = getQuery(c.event)
      return listDeviations(c.db, c.actor, { project_id: q.project_id, responsible_user_id: q.responsible_user_id, status: q.status })
    }),
  projectList: () => inspectionHandler('internal', (c) => getProjectInspections(c.db, c.actor, param(c.event, 'id'))),
  projectCreate: () =>
    inspectionHandler('internal', async (c) => {
      const projectId = param(c.event, 'id')
      const b = await body(c.event)
      const ids = await createInspections(c.db, c.actor, projectId, b.inspections)
      setResponseStatus(c.event, 201)
      return { ids, ...(await getProjectInspections(c.db, c.actor, projectId)) }
    }),
  projectProtocol: () =>
    inspectionHandler('internal', async (c) =>
      sendPdf(c.event, await exportProjectProtocol(c.db, c.actor, param(c.event, 'id'), { loadImage: pdfImageLoader(c.storage) }))
    ),
}
