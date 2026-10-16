// Egenkontroller – export till PDF (en kontroll eller projektets slutprotokoll).
//
// Nitro-fri. Godkända kontroller renderas ALLTID från sin låsta
// ögonblicksbild (approved_snapshot), så en tidigare godkänd revision ger
// samma innehåll även efter senare kompletteringar. Övriga renderas från
// aktuella data och märks med sin faktiska status.

import type { InspectionSnapshot } from '../../shared/inspectionTypes'
import {
  buildInspectionSnapshot,
  loadInspectionProject,
  loadInspectionRow,
  requireInspectionReviewer,
  type InspectionActor,
  type InspQueryable,
} from './inspectionCore'
import { listInspections } from './inspectionRun'
import {
  inspectionPdfFilename,
  protocolIsComplete,
  protocolPdfFilename,
  renderFinalProtocol,
  renderInspectionPdf,
  type InspectionPdfOptions,
} from './inspectionPdf'

export async function inspectionSnapshotFor(q: InspQueryable, actor: InspectionActor, id: unknown): Promise<InspectionSnapshot> {
  const row = await loadInspectionRow(q, actor, id)
  if (row.status === 'approved') return row.approved_snapshot as InspectionSnapshot
  return buildInspectionSnapshot(q, actor, row)
}

export async function exportInspectionPdf(q: InspQueryable, actor: InspectionActor, id: unknown, opts: InspectionPdfOptions) {
  const snap = await inspectionSnapshotFor(q, actor, id)
  return { bytes: await renderInspectionPdf(snap, opts), filename: inspectionPdfFilename(snap) }
}

export async function exportProjectProtocol(q: InspQueryable, actor: InspectionActor, projectId: unknown, opts: InspectionPdfOptions) {
  requireInspectionReviewer(actor)
  const project = await loadInspectionProject(q, actor, projectId)
  const org = (await q.query('SELECT name FROM organizations WHERE id = $1', [actor.orgId])).rows[0]
  const list = await listInspections(q, actor, { project_id: project.id })
  const approved: InspectionSnapshot[] = []
  for (const i of list.filter((x) => x.status === 'approved')) {
    const row = (await q.query('SELECT approved_snapshot FROM inspections WHERE id = $1 AND org_id = $2', [i.id, actor.orgId])).rows[0]
    if (row?.approved_snapshot) approved.push(row.approved_snapshot as InspectionSnapshot)
  }
  const { rows: devs } = await q.query(
    `SELECT d.description, d.status, d.responsible_name, d.due_date, it.title AS item_title, i.name AS inspection_name, i.location
     FROM inspection_deviations d
     JOIN inspection_items it ON it.id = d.item_id
     JOIN inspections i ON i.id = d.inspection_id
     WHERE d.org_id = $1 AND d.project_id = $2 AND d.status <> 'verified'
     ORDER BY i.name, d.id`,
    [actor.orgId, project.id]
  )
  const input = {
    org: { name: org?.name ?? '' },
    project: {
      id: Number(project.id),
      project_number: project.project_number,
      name: project.name,
      site_address: project.site_address ?? null,
      customer_name: project.customer_name ?? null,
      work_type: project.work_type ?? 'project',
    },
    generated_at: new Date().toISOString(),
    inspections: list.map((i) => ({
      name: i.name,
      kind: i.kind,
      location: i.location,
      status: i.status,
      revision: i.revision,
      coverage: i.coverage,
      open_deviations: i.open_deviations,
    })),
    approved,
    open_deviations: devs.map((d) => ({
      inspection_name: d.inspection_name,
      location: d.location ?? null,
      item_title: d.item_title,
      description: d.description,
      status: d.status,
      responsible_name: d.responsible_name ?? null,
      due_date: d.due_date ?? null,
    })),
  }
  return {
    bytes: await renderFinalProtocol(input, opts),
    filename: protocolPdfFilename(project.project_number, protocolIsComplete(input)),
    complete: protocolIsComplete(input),
  }
}
