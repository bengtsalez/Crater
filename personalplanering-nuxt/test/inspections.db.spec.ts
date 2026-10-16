import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './pgliteDb'
import { seed } from './seed'
import { fakeJpeg, memoryStorage } from './memoryStorage'
import { InspectionError, type InspectionActor } from '../server/utils/inspectionCore'
import {
  createTemplate,
  getTemplate,
  importExampleTemplates,
  listTemplates,
  publishTemplate,
  saveTemplateDraft,
} from '../server/utils/inspectionTemplates'
import {
  createInspections,
  createRevision,
  getInspection,
  getProjectInspections,
  listInspections,
  replaceInspectionItems,
  saveAnswer,
  updateInspectionMeta,
} from '../server/utils/inspectionRun'
import { transitionInspection } from '../server/utils/inspectionReview'
import {
  linkDeviationTask,
  listDeviations,
  reopenDeviation,
  resolveDeviation,
  verifyDeviation,
} from '../server/utils/inspectionDeviations'
import { attachmentUrl, confirmUpload, removeAttachment, requestUpload } from '../server/utils/inspectionAttachments'
import { exportInspectionPdf, exportProjectProtocol, inspectionSnapshotFor } from '../server/utils/inspectionExport'

const TODAY = '2026-10-16'
let db: TestDb
let s: Awaited<ReturnType<typeof seed>>
let admin: InspectionActor
let pm: InspectionActor
let anna: InspectionActor
let bo: InspectionActor
let adminB: InspectionActor
const storage = memoryStorage()

async function expectError(p: Promise<unknown>, status: number, re?: RegExp, code?: string) {
  try {
    await p
  } catch (err) {
    expect(err).toBeInstanceOf(InspectionError)
    expect((err as InspectionError).status).toBe(status)
    if (re) expect((err as Error).message).toMatch(re)
    if (code) expect((err as InspectionError).code).toBe(code)
    return err as InspectionError
  }
  throw new Error(`Förväntade fel ${status}`)
}

const TEMPLATE = {
  name: 'Dränering',
  kind: 'self_inspection',
  description: 'Test',
  sections: [
    {
      title: 'Före start',
      items: [
        { key: 'a', title: 'Ledningar utsatta', answer_type: 'result', required: true, critical: true },
        { key: 'b', title: 'Foto av befintligt skick', answer_type: 'result', required: true, min_photos: 1 },
      ],
    },
    {
      title: 'Montering',
      items: [
        { key: 'c', title: 'Schaktdjup', answer_type: 'number', unit: 'm', required: true },
        { key: 'd', title: 'Anteckning', answer_type: 'text', required: false },
      ],
    },
  ],
}

let templateId: number

async function publishedTemplate(content = TEMPLATE) {
  const t = await createTemplate(db, admin, content)
  const p = await publishTemplate(db, admin, t.id, t.draft_rev)
  return p
}

async function newInspection(location: string, responsible: number | null = s.anna, project = s.p1) {
  const [id] = await createInspections(db, pm, project, [{ template_id: templateId, location, responsible_user_id: responsible }])
  return id!
}

async function view(id: number, actor = pm) {
  return getInspection(db, actor, id, true)
}

async function answer(id: number, actor: InspectionActor, key: string, value: Record<string, unknown>) {
  const v = await view(id, actor.role === 'employee' ? actor : pm)
  const item = v.items.find((i) => i.item_key === key)!
  await saveAnswer(db, actor, id, item.id, { ...value, rev: item.rev })
  return item
}

async function uploadPhoto(id: number, actor: InspectionActor, target: { item_id?: number; deviation_id?: number }, bytes = fakeJpeg(800, 600)) {
  const up = await requestUpload(db, actor, storage, id, { ...target, content_type: 'image/jpeg', byte_size: bytes.length })
  const key = (await db.query('SELECT storage_key FROM inspection_attachments WHERE id = $1', [up.id])).rows[0].storage_key
  storage.put(key, bytes)
  await confirmUpload(db, actor, storage, id, up.id)
  return up.id
}

/** Fyller i alla obligatoriska punkter korrekt (inkl. foto). */
async function completeAll(id: number, actor: InspectionActor) {
  await answer(id, actor, 'a', { result: 'ok' })
  const b = await answer(id, actor, 'b', { result: 'ok' })
  await uploadPhoto(id, actor, { item_id: b.id })
  await answer(id, actor, 'c', { number_value: '1,25' })
}

beforeAll(async () => {
  db = await createTestDb()
  s = await seed(db, TODAY)
  const adminId = (await db.query("INSERT INTO users (org_id, username, password_hash, role) VALUES ($1,'chef','x','admin') RETURNING id", [s.orgA])).rows[0].id
  const adminBId = (await db.query("INSERT INTO users (org_id, username, password_hash, role) VALUES ($1,'bchef','x','admin') RETURNING id", [s.orgB])).rows[0].id
  admin = { orgId: s.orgA, userId: adminId, role: 'admin', name: 'chef', resourceId: null }
  pm = { orgId: s.orgA, userId: s.pm, role: 'member', name: 'pm', resourceId: null }
  anna = { orgId: s.orgA, userId: s.anna, role: 'employee', name: 'anna', resourceId: s.rAnna }
  bo = { orgId: s.orgA, userId: s.bo, role: 'employee', name: 'bo', resourceId: s.rBo }
  adminB = { orgId: s.orgB, userId: adminBId, role: 'admin', name: 'bchef', resourceId: null }
  templateId = (await publishedTemplate()).id
}, 60000)

afterAll(() => db.close())

describe('mallar och versioner', () => {
  it('bara admin hanterar mallar; member ser bara publicerade aktiva', async () => {
    await expectError(createTemplate(db, pm, TEMPLATE), 403)
    const draftOnly = await createTemplate(db, admin, { ...TEMPLATE, name: 'Opublicerad' })
    const memberList = await listTemplates(db, pm)
    expect(memberList.map((t) => t.id)).toContain(templateId)
    expect(memberList.map((t) => t.id)).not.toContain(draftOnly.id)
    await expectError(getTemplate(db, pm, draftOnly.id), 404)
    await expectError(listTemplates(db, anna), 403)
  })

  it('publicerad version är oföränderlig och projektkopian påverkas inte av senare ändringar', async () => {
    const id = await newInspection('Version-test')
    const t = await getTemplate(db, admin, templateId)
    await saveTemplateDraft(
      db,
      admin,
      templateId,
      { ...TEMPLATE, sections: [{ title: 'Nytt', items: [{ key: 'z', title: 'Helt ny punkt', answer_type: 'checkbox' }] }] },
      t.draft_rev
    )
    const t2 = await getTemplate(db, admin, templateId)
    await publishTemplate(db, admin, templateId, t2.draft_rev)
    const after = await getTemplate(db, admin, templateId)
    expect(after.latest_version).toBe(2)
    expect(after.versions.map((v) => v.version)).toEqual([2, 1])

    const v = await view(id)
    expect(v.template_version).toBe(1)
    expect(v.items.map((i) => i.item_key)).toEqual(['a', 'b', 'c', 'd'])

    // Databasen stoppar ändring av en publicerad version.
    await expect(db.query("UPDATE inspection_template_versions SET name = 'x' WHERE template_id = $1", [templateId])).rejects.toThrow(/oföränderliga/)

    // Återställ v3 = ursprungligt innehåll för övriga tester.
    const t3 = await getTemplate(db, admin, templateId)
    await saveTemplateDraft(db, admin, templateId, TEMPLATE, t3.draft_rev)
    await publishTemplate(db, admin, templateId, (await getTemplate(db, admin, templateId)).draft_rev)
  })

  it('äldre utkastformulär skriver inte över nyare utkast', async () => {
    const t = await createTemplate(db, admin, { ...TEMPLATE, name: 'Samtidig' })
    await saveTemplateDraft(db, admin, t.id, { ...TEMPLATE, name: 'Första' }, t.draft_rev)
    await expectError(saveTemplateDraft(db, admin, t.id, { ...TEMPLATE, name: 'Andra' }, t.draft_rev), 409, undefined, 'conflict')
    expect((await getTemplate(db, admin, t.id)).draft?.name).toBe('Första')
  })

  it('exempelmallar importeras idempotent och bara för det egna företaget', async () => {
    const first = await importExampleTemplates(db, admin)
    expect(first.added).toBe(4)
    const again = await importExampleTemplates(db, admin)
    expect(again.added).toBe(0)
    const names = (await listTemplates(db, admin)).map((t) => t.name)
    expect(names).toContain('Dränering (exempel)')
    expect((await listTemplates(db, adminB)).length).toBe(0)
    // Inga kontroller skapades på befintliga projekt.
    expect((await db.query("SELECT count(*)::int AS n FROM inspections WHERE name LIKE '%(exempel)%'")).rows[0].n).toBe(0)
  })
})

describe('kontroller på projekt', () => {
  it('samma mall ger separata kontroller för olika etapper', async () => {
    const north = await newInspection('Norrsida')
    const south = await newInspection('Södersida')
    await answer(north, anna, 'a', { result: 'ok' })
    const vn = await view(north)
    const vs = await view(south)
    expect(vn.items.find((i) => i.item_key === 'a')!.answer?.result).toBe('ok')
    expect(vs.items.find((i) => i.item_key === 'a')!.answer).toBeNull()
    expect(vn.status).toBe('in_progress')
    expect(vs.status).toBe('draft')
    const locations = (await getProjectInspections(db, pm, s.p1)).inspections.map((i) => i.location)
    expect(locations).toEqual(expect.arrayContaining(['Norrsida', 'Södersida']))
  })

  it('projekt utan kontroller ser inte färdigkontrollerat ut', async () => {
    const view = await getProjectInspections(db, pm, s.p2)
    expect(view.summary.state).toBe('none')
    expect(view.summary.total).toBe(0)
  })

  it('projektanpassning tillåts bara innan arbetet påbörjats', async () => {
    const id = await newInspection('Anpassning')
    const v = await view(id)
    await replaceInspectionItems(db, pm, id, [{ title: 'Eget', items: [{ key: 'x', title: 'Projektets egen punkt', answer_type: 'result' }] }], v.lock_version)
    const v2 = await view(id)
    expect(v2.items.map((i) => i.title)).toEqual(['Projektets egen punkt'])
    await saveAnswer(db, anna, id, v2.items[0]!.id, { result: 'ok', rev: 0 })
    await expectError(
      replaceInspectionItems(db, pm, id, [{ title: 'Eget', items: [{ key: 'y', title: 'Annan', answer_type: 'result' }] }], (await view(id)).lock_version),
      409,
      undefined,
      'needs_revision'
    )
  })
})

describe('inlämning', () => {
  it('ofullständiga svar, saknad motivering och saknade bilder stoppar inlämning', async () => {
    const id = await newInspection('Inlämning')
    const err = await expectError(transitionInspection(db, anna, id, 'submit'), 400, /Obesvarad/, 'incomplete')
    expect((err.extra?.problems as unknown[]).length).toBe(3)

    await answer(id, anna, 'a', { result: 'na' }) // utan motivering
    const b = await answer(id, anna, 'b', { result: 'ok' })
    await answer(id, anna, 'c', { number_value: '2' })
    await expectError(transitionInspection(db, anna, id, 'submit'), 400, /motivering/)
    await answer(id, anna, 'a', { result: 'na', na_reason: 'Inga ledningar i området enligt ledningskoll' })
    await expectError(transitionInspection(db, anna, id, 'submit'), 400, /bild/)

    // En begärd men inte bekräftad uppladdning räknas inte.
    await requestUpload(db, anna, storage, id, { item_id: b.id, content_type: 'image/jpeg', byte_size: 1000 })
    await expectError(transitionInspection(db, anna, id, 'submit'), 400, /bild/)

    await uploadPhoto(id, anna, { item_id: b.id })
    await transitionInspection(db, anna, id, 'submit')
    expect((await view(id)).status).toBe('submitted')
  })

  it('Ej tillämplig med motivering ersätter fotokravet', async () => {
    const id = await newInspection('NA-foto')
    await answer(id, anna, 'a', { result: 'ok' })
    await answer(id, anna, 'b', { result: 'na', na_reason: 'Ytan är redan dokumenterad i etapp 1' })
    await answer(id, anna, 'c', { result: 'na', na_reason: 'Mäts inte på denna etapp' })
    await transitionInspection(db, anna, id, 'submit')
  })

  it('dubbel och samtidig inlämning ger exakt en inlämning', async () => {
    const id = await newInspection('Dubbelklick')
    await completeAll(id, anna)
    const results = await Promise.allSettled([
      transitionInspection(db, anna, id, 'submit'),
      transitionInspection(db, anna, id, 'submit'),
    ])
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1)
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect((rejected.reason as InspectionError).status).toBe(409)
    const events = (await db.query("SELECT count(*)::int AS n FROM inspection_events WHERE inspection_id = $1 AND event_type = 'submitted'", [id])).rows[0].n
    expect(events).toBe(1)
    const acts = (await db.query("SELECT count(*)::int AS n FROM activity_events WHERE entity_id = $1 AND event_type = 'inspection.submitted'", [id])).rows[0].n
    expect(acts).toBe(1)
  })
})

describe('samtidiga sparningar', () => {
  it('ett äldre formulär skriver inte över ett nyare svar', async () => {
    const id = await newInspection('Konflikt')
    const item = (await view(id)).items.find((i) => i.item_key === 'a')!
    await saveAnswer(db, anna, id, item.id, { result: 'ok', comment: 'Anna först', rev: 0 })
    const err = await expectError(saveAnswer(db, pm, id, item.id, { result: 'deviation', comment: 'PM med gammal vy', rev: 0 }), 409, undefined, 'conflict')
    expect(err.extra?.current_rev).toBe(1)
    const a = (await view(id)).items.find((i) => i.item_key === 'a')!.answer!
    expect(a.comment).toBe('Anna först')
    expect(a.answered_by_name).toBe('anna')
    // Med rätt revision går det bra, och historiken visar båda.
    await saveAnswer(db, pm, id, item.id, { result: 'ok', comment: 'PM kompletterar', rev: 1 })
    const hist = (await db.query('SELECT user_name FROM inspection_answer_history WHERE item_id = $1 ORDER BY id', [item.id])).rows
    expect(hist.map((h) => h.user_name)).toEqual(['anna', 'pm'])
  })

  it('parallella sparningar med samma revision: exakt en lyckas', async () => {
    const id = await newInspection('Parallell')
    const item = (await view(id)).items.find((i) => i.item_key === 'a')!
    const r = await Promise.allSettled([
      saveAnswer(db, anna, id, item.id, { result: 'ok', comment: 'ett', rev: 0 }),
      saveAnswer(db, pm, id, item.id, { result: 'ok', comment: 'två', rev: 0 }),
    ])
    expect(r.filter((x) => x.status === 'fulfilled').length).toBe(1)
  })
})

describe('avvikelser och godkännande', () => {
  it('öppna eller bara åtgärdade avvikelser stoppar godkännande tills de verifierats', async () => {
    const id = await newInspection('Avvikelse')
    await completeAll(id, anna)
    // Utan beskrivning skapas ingen avvikelsepost – punkten markeras ofullständig.
    await answer(id, anna, 'a', { result: 'deviation' })
    expect((await view(id)).deviations.length).toBe(0)
    expect((await view(id)).items.find((i) => i.item_key === 'a')!.evaluation.problems).toContain('Avvikelse kräver beskrivning')
    await answer(id, anna, 'a', { result: 'deviation', comment: 'Ledning i konflikt med schakt' })
    // Upprepad sparning uppdaterar samma avvikelse.
    await answer(id, anna, 'a', { result: 'deviation', comment: 'Ledning i konflikt med schakt – fjärrvärme' })
    let v = await view(id)
    expect(v.deviations.length).toBe(1)
    expect(v.deviations[0]!.description).toMatch(/fjärrvärme/)
    // Svar ändrat till Godkänd stänger inte avvikelsen.
    await answer(id, anna, 'a', { result: 'ok' })
    v = await view(id)
    expect(v.deviations[0]!.status).toBe('open')

    await transitionInspection(db, anna, id, 'submit') // tillåtet med öppen avvikelse
    await expectError(transitionInspection(db, pm, id, 'approve'), 409, /verifierade/, 'open_deviations')
    const dev = v.deviations[0]!
    await expectError(verifyDeviation(db, pm, id, dev.id), 409) // måste åtgärdas först
    await resolveDeviation(db, anna, id, dev.id, { action_description: 'Schakt flyttat 0,5 m', rev: dev.rev })
    await expectError(transitionInspection(db, pm, id, 'approve'), 409, undefined, 'open_deviations')
    await expectError(verifyDeviation(db, anna, id, dev.id), 403)
    await verifyDeviation(db, pm, id, dev.id)
    await transitionInspection(db, pm, id, 'approve', { comment: 'OK' })
    v = await view(id)
    expect(v.status).toBe('approved')
    expect(v.approved_by_name).toBe('pm')
  })

  it('återöppning kräver motivering och behåller historiken', async () => {
    const id = await newInspection('Återöppna')
    await answer(id, anna, 'a', { result: 'deviation', comment: 'Spricka' })
    const dev = (await view(id)).deviations[0]!
    await resolveDeviation(db, anna, id, dev.id, { action_description: 'Lagad', rev: dev.rev })
    await verifyDeviation(db, pm, id, dev.id)
    await expectError(reopenDeviation(db, pm, id, dev.id, {}), 400, /Motivering/)
    await reopenDeviation(db, pm, id, dev.id, { reason: 'Sprickan syns igen' })
    const hist = (await db.query('SELECT event_type FROM inspection_deviation_history WHERE deviation_id = $1 ORDER BY id', [dev.id])).rows
    expect(hist.map((h) => h.event_type)).toEqual(['reported', 'resolved', 'verified', 'reopened'])
    const d2 = (await view(id)).deviations[0]!
    expect(d2.status).toBe('open')
    expect(d2.action_description).toBe('Lagad')
  })

  it('koppling till uppgift skapar högst en uppgift', async () => {
    const id = await newInspection('Uppgift')
    await answer(id, anna, 'a', { result: 'deviation', comment: 'Saknas material' })
    const dev = (await view(id)).deviations[0]!
    const a = await linkDeviationTask(db, pm, id, dev.id)
    const b = await linkDeviationTask(db, pm, id, dev.id)
    expect(a.created).toBe(true)
    expect(b).toEqual({ task_id: a.task_id, created: false })
    const t = (await db.query('SELECT user_id, project_id FROM tasks WHERE id = $1', [a.task_id])).rows[0]
    expect(t.user_id).toBe(s.anna)
    expect(t.project_id).toBe(s.p1)
  })

  it('avvikelselistan filtrerar på status, projekt och ansvarig', async () => {
    const open = await listDeviations(db, pm, { status: 'open' })
    expect(open.length).toBeGreaterThan(0)
    expect(open.every((d) => d.status === 'open')).toBe(true)
    expect((await listDeviations(db, pm, { project_id: s.p2 })).length).toBe(0)
    expect((await listDeviations(db, pm, { responsible_user_id: s.anna })).length).toBeGreaterThan(0)
    await expectError(listDeviations(db, anna), 403)
  })
})

describe('statusregler och låsning', () => {
  it('otillåtna övergångar och redigering av låsta protokoll nekas', async () => {
    const id = await newInspection('Lås')
    await expectError(transitionInspection(db, pm, id, 'approve'), 409, undefined, 'invalid_transition')
    await expectError(transitionInspection(db, pm, id, 'request_changes', { comment: 'x' }), 409)
    await expectError(transitionInspection(db, pm, id, 'fly'), 400)
    await completeAll(id, anna)
    await transitionInspection(db, anna, id, 'submit')
    // Personal får inte ändra inlämnade svar, inte godkänna och inte begära komplettering.
    const item = (await view(id)).items[0]!
    await expectError(saveAnswer(db, anna, id, item.id, { result: 'deviation', comment: 'x', rev: item.rev }), 409, /inlämnad/, 'locked')
    await expectError(transitionInspection(db, anna, id, 'approve'), 403)
    await expectError(transitionInspection(db, pm, id, 'request_changes'), 400, /Kommentar/)
    await transitionInspection(db, pm, id, 'request_changes', { comment: 'Bild på ledning saknas' })
    let v = await view(id)
    expect(v.status).toBe('changes_requested')
    expect(v.review_comment).toBe('Bild på ledning saknas')
    await saveAnswer(db, anna, id, item.id, { result: 'ok', comment: 'Kompletterat', rev: item.rev })
    await transitionInspection(db, anna, id, 'submit')
    await transitionInspection(db, pm, id, 'approve')
    v = await view(id)
    const it2 = v.items[0]!
    await expectError(saveAnswer(db, pm, id, it2.id, { result: 'ok', rev: it2.rev }), 409, /godkänd/)
    await expectError(updateInspectionMeta(db, pm, id, { location: 'Ny' }), 409)
    const photo = v.items.find((i) => i.photos.length)!.photos[0]!
    await expectError(removeAttachment(db, pm, storage, id, photo.id), 409, /låst/)
    // Försvar på djupet: databasen nekar också direkta ändringar.
    await expect(db.query("UPDATE inspection_answers SET comment = 'hack' WHERE item_id = $1", [it2.id])).rejects.toThrow(/låst/)
  })
})

describe('åtkomst', () => {
  it('personal ser och ändrar bara tilldelade kontroller på tillgängliga projekt', async () => {
    const annas = await newInspection('Annas', s.anna)
    const unassigned = await newInspection('Ingen ansvarig', null)
    const pmOwned = await newInspection('PM:s', s.pm)
    // Bo är tilldelad men saknar bokning på P1 → tilldelningen öppnar inte projektet.
    const bosOnP1 = await newInspection('Bos på P1', s.bo)

    await expect(getInspection(db, anna, annas, true)).resolves.toBeTruthy()
    for (const id of [unassigned, pmOwned]) await expectError(getInspection(db, anna, id, true), 404)
    await expectError(getInspection(db, bo, bosOnP1, true), 404)
    const item = (await view(bosOnP1)).items[0]!
    await expectError(saveAnswer(db, bo, bosOnP1, item.id, { result: 'ok', rev: 0 }), 404)
    await expectError(transitionInspection(db, bo, bosOnP1, 'submit'), 404)
    await expectError(requestUpload(db, bo, storage, bosOnP1, { item_id: item.id, content_type: 'image/jpeg', byte_size: 10 }), 404)
    await expectError(exportInspectionPdf(db, bo, bosOnP1, {}), 404)

    const list = await listInspections(db, anna)
    expect(list.every((i) => i.responsible_user_id === s.anna)).toBe(true)
    expect(list.map((i) => i.id)).toContain(annas)
    expect(await listInspections(db, bo)).toEqual([])

    // Bokningen tas bort → åtkomsten försvinner direkt.
    const saved = (await db.query('DELETE FROM assignments WHERE resource_id = $1 AND project_id = $2 RETURNING *', [s.rAnna, s.p1])).rows
    await expectError(getInspection(db, anna, annas, true), 404)
    for (const a of saved) {
      await db.query('INSERT INTO assignments (org_id, resource_id, project_id, start_date, end_date) VALUES ($1,$2,$3,$4,$5)', [
        a.org_id, a.resource_id, a.project_id, a.start_date, a.end_date,
      ])
    }
    await expect(getInspection(db, anna, annas, true)).resolves.toBeTruthy()
  })

  it('åtkomst över företagsgränser nekas – även bilder, export och id-baserade anrop', async () => {
    const id = await newInspection('Org-gräns')
    const b = (await view(id)).items.find((i) => i.item_key === 'b')!
    const photoId = await uploadPhoto(id, anna, { item_id: b.id })
    await expectError(getInspection(db, adminB, id, true), 404)
    await expectError(saveAnswer(db, adminB, id, b.id, { result: 'ok', rev: 0 }), 404)
    await expectError(transitionInspection(db, adminB, id, 'archive'), 404)
    await expectError(attachmentUrl(db, adminB, storage, id, photoId), 404)
    await expectError(removeAttachment(db, adminB, storage, id, photoId), 404)
    await expectError(exportInspectionPdf(db, adminB, id, {}), 404)
    await expectError(exportProjectProtocol(db, adminB, s.p1, {}), 404)
    await expectError(getProjectInspections(db, adminB, s.p1), 404)
    await expectError(createInspections(db, adminB, s.p3, [{ template_id: templateId }]), 400, /Mallen/)
    await expectError(createInspections(db, pm, s.p1, [{ template_id: templateId, responsible_user_id: s.carl }]), 400, /Ansvarig/)
    expect(await listInspections(db, adminB)).toEqual([])
    // Signerad adress ges bara efter behörighetskontroll.
    expect(await attachmentUrl(db, pm, storage, id, photoId)).toMatch(/sig=get/)
  })

  it('felaktig filtyp avvisas efter uppladdning och räknas inte', async () => {
    const id = await newInspection('Filtyp')
    const b = (await view(id)).items.find((i) => i.item_key === 'b')!
    await expectError(requestUpload(db, anna, storage, id, { item_id: b.id, content_type: 'application/pdf', byte_size: 10 }), 400, /JPEG/)
    await expectError(requestUpload(db, anna, storage, id, { item_id: b.id, content_type: 'image/jpeg', byte_size: 50 * 1024 * 1024 }), 400, /stor/)
    const up = await requestUpload(db, anna, storage, id, { item_id: b.id, content_type: 'image/jpeg', byte_size: 20 })
    const key = (await db.query('SELECT storage_key FROM inspection_attachments WHERE id = $1', [up.id])).rows[0].storage_key
    expect(key).toMatch(new RegExp(`^org/${s.orgA}/inspections/${id}/`))
    storage.put(key, new TextEncoder().encode('%PDF-1.7 inte en bild'))
    await expectError(confirmUpload(db, anna, storage, id, up.id), 400, /giltig/)
    expect(storage.objects.has(key)).toBe(false)
    expect((await view(id)).items.find((i) => i.item_key === 'b')!.photos.length).toBe(0)
  })

  it('utan lagringskonfiguration nekas uppladdning tydligt', async () => {
    const { unconfiguredStorage } = await import('../server/utils/inspectionStorage')
    const id = await newInspection('Ingen lagring')
    const b = (await view(id)).items.find((i) => i.item_key === 'b')!
    await expectError(requestUpload(db, anna, unconfiguredStorage, id, { item_id: b.id, content_type: 'image/jpeg', byte_size: 10 }), 503, /inte konfigurerad/, 'storage_not_configured')
    expect((await getInspection(db, anna, id, false)).storage_configured).toBe(false)
  })
})

describe('revisioner', () => {
  it('godkända revisionsunderlag förblir intakta efter komplettering', async () => {
    const id = await newInspection('Revision')
    await completeAll(id, anna)
    await transitionInspection(db, anna, id, 'submit')
    await transitionInspection(db, pm, id, 'approve', { comment: 'Godkänd v1' })
    const snapBefore = JSON.stringify((await db.query('SELECT approved_snapshot FROM inspections WHERE id = $1', [id])).rows[0].approved_snapshot)
    const pdfBefore = await exportInspectionPdf(db, pm, id, {})

    await expectError(createRevision(db, pm, id, {}), 400, /Orsak/)
    await expectError(createRevision(db, anna, id, { reason: 'x' }), 403)
    const rev2 = await createRevision(db, pm, id, { reason: 'Fel mätvärde angivet' })
    // Dubbelklick ger ingen andra revision av samma underlag.
    await expectError(createRevision(db, pm, id, { reason: 'Igen' }), 409, undefined, 'superseded')

    const v2 = await view(rev2)
    expect(v2.revision).toBe(2)
    expect(v2.status).toBe('in_progress')
    expect(v2.revision_reason).toBe('Fel mätvärde angivet')
    expect(v2.items.find((i) => i.item_key === 'c')!.answer?.number_value).toBe('1.25')
    expect(v2.items.find((i) => i.item_key === 'b')!.photos.length).toBe(1)
    await answer(rev2, anna, 'c', { number_value: '1,4' })
    await transitionInspection(db, anna, rev2, 'submit')
    await transitionInspection(db, pm, rev2, 'approve')

    const old = await view(id)
    expect(old.status).toBe('approved')
    expect(old.superseded_by_id).toBe(rev2)
    expect(old.items.find((i) => i.item_key === 'c')!.answer?.number_value).toBe('1.25')
    expect(old.revisions.map((r) => r.revision)).toEqual([1, 2])
    const snapAfter = JSON.stringify((await db.query('SELECT approved_snapshot FROM inspections WHERE id = $1', [id])).rows[0].approved_snapshot)
    expect(snapAfter).toBe(snapBefore)
    const snap1 = await inspectionSnapshotFor(db, pm, id)
    expect(snap1.items.find((i) => i.item_key === 'c')!.answer?.number_value).toBe('1.25')
    const pdfAfter = await exportInspectionPdf(db, pm, id, {})
    expect(pdfAfter.filename).toBe(pdfBefore.filename)
    expect(pdfAfter.bytes.length).toBeGreaterThan(1000)

    // Projektlistan visar bara den aktuella revisionen; personal ser inte den ersatta.
    const list = (await getProjectInspections(db, pm, s.p1)).inspections.filter((i) => i.location === 'Revision')
    expect(list.map((i) => i.id)).toEqual([rev2])
    await expectError(getInspection(db, anna, id, true), 404)
    // Bilden i den låsta revisionen finns kvar i lagringen även om den tas bort i en ny.
    const rev3 = await createRevision(db, pm, rev2, { reason: 'Byt bild' })
    const photo = (await view(rev3)).items.find((i) => i.item_key === 'b')!.photos[0]!
    const key = (await db.query('SELECT storage_key FROM inspection_attachments WHERE id = $1', [photo.id])).rows[0].storage_key
    await removeAttachment(db, pm, storage, rev3, photo.id)
    expect(storage.objects.has(key)).toBe(true)
  })

  it('ändrade krav via revision bevarar tidigare underlag och flyttar öppna avvikelser', async () => {
    const id = await newInspection('Ändrade krav')
    await answer(id, anna, 'a', { result: 'deviation', comment: 'Fel läge' })
    const sections = [
      { title: 'Före start', items: [{ key: 'a', title: 'Ledningar utsatta', answer_type: 'result', min_photos: 1 }] },
    ]
    const rev2 = await createRevision(db, pm, id, { reason: 'Projektet kräver foto', sections })
    const v2 = await view(rev2)
    expect(v2.items.length).toBe(1)
    expect(v2.items[0]!.min_photos).toBe(1)
    expect(v2.items[0]!.answer?.result).toBe('deviation')
    expect(v2.deviations.length).toBe(1)
    const old = await view(id)
    expect(old.status).toBe('archived')
    expect(old.items.length).toBe(4)
    // En punkt med öppen avvikelse kan inte tas bort.
    await expectError(
      createRevision(db, pm, rev2, { reason: 'Ta bort', sections: [{ title: 'X', items: [{ key: 'n', title: 'Ny', answer_type: 'checkbox' }] }] }),
      409,
      /avvikelse/
    )
  })
})

describe('export', () => {
  it('slutprotokollet visar kvarvarande kontroller och öppna avvikelser', async () => {
    const res = await exportProjectProtocol(db, pm, s.p1, {})
    expect(res.complete).toBe(false)
    expect(res.filename).toMatch(/ofullstandigt/)
    expect(Buffer.from(res.bytes.slice(0, 5)).toString()).toBe('%PDF-')
    await expectError(exportProjectProtocol(db, anna, s.p1, {}), 403)
  })
})
