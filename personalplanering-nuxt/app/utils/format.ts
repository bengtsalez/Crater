export function formatSum(sum: number | null | undefined | ''): string {
  if (sum === null || sum === undefined || sum === '') return '–'
  return new Intl.NumberFormat('sv-SE').format(sum) + ' kr'
}

export function taskCountLabel(n: number): string {
  return `${n} uppgift${n === 1 ? '' : 'er'}`
}
