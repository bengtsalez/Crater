/**
 * Ersätter de tidigare hårdkodade konstanterna RESOURCE_CATEGORIES / CATEGORY_LABELS.
 * Avdelningar är nu per-org och laddas av useAppData().loadAll().
 */
export function useDepartments() {
  const { departments } = useAppData()

  const sorted = computed(() =>
    [...departments.value].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
  )
  const options = computed(() => sorted.value.map((d) => ({ value: d.key, label: d.label })))
  const keys = computed(() => sorted.value.map((d) => d.key))
  const labelFor = (key?: string | null) =>
    key ? sorted.value.find((d) => d.key === key)?.label ?? key : '–'

  return { departments: sorted, options, keys, labelFor }
}
