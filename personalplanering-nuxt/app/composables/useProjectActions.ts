import type { Project } from '../types'

/**
 * Delade projektåtgärder (status + borttagning) med enhetlig felhantering och
 * omladdning. Borttagning kräver att användaren skriver projektnumret – en
 * medveten spärr mot oavsiktliga DELETE i normal drift, där projekt istället
 * ska markeras avslutade.
 */
export function useProjectActions() {
  const { api } = useApi()
  const { loadAll } = useAppData()
  const toast = useToast()

  async function run(fn: () => Promise<unknown>): Promise<boolean> {
    try {
      await fn()
      await loadAll()
      return true
    } catch (err) {
      toast.add({ title: (err as Error).message, color: 'error' })
      return false
    }
  }

  function setStatus(
    id: number,
    statusOverride: 'aktiv' | 'planerad' | 'avslutad' | null
  ): Promise<boolean> {
    return run(() => api('PUT', `/api/projects/${id}`, { status_override: statusOverride }))
  }

  function remove(project: Pick<Project, 'id' | 'project_number'>): Promise<boolean> {
    const answer = window.prompt(
      `Ta bort projektet permanent?\n\nSkriv projektnumret "${project.project_number}" för att bekräfta:`
    )
    if (answer?.trim() !== project.project_number) return Promise.resolve(false)
    return run(() => api('DELETE', `/api/projects/${project.id}`))
  }

  return { setStatus, remove }
}
