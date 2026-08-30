import { RESOURCE_PALETTE } from './constants'
import type { Resource } from '../types'

const HEX_RE = /^#[0-9a-fA-F]{6}$/

// Resursens tidslinjefärg: egen vald färg om giltig, annars en stabil palettfärg per id.
export function colorForResource(resource: Pick<Resource, 'id' | 'color'> | null | undefined): string {
  if (resource && typeof resource.color === 'string' && HEX_RE.test(resource.color)) {
    return resource.color
  }
  const n = RESOURCE_PALETTE.length
  const idx = (((Number(resource?.id) - 1) % n) + n) % n
  return RESOURCE_PALETTE[Number.isFinite(idx) ? idx : 0]!
}

export function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
}

export function rgbToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
      .join('')
  )
}

// Linjär blandning av hex mot target ('#ffffff' eller '#000000'), amount 0..1.
export function mixHex(hex: string, target: string, amount: number): string {
  const a = hexToRgb(hex)
  const b = hexToRgb(target)
  return rgbToHex(
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount
  )
}

// Deterministisk, subtil nyans av basfärgen per projekt, så överlappande projekt i samma rad går
// att skilja åt utan att grundfärgen tappas bort.
export function shadeForProject(baseHex: string, projectId: number): string {
  const step = ((Number(projectId) * 7) % 5) - 2 // heltal -2..2
  if (!Number.isFinite(step) || step === 0) return baseHex
  return step > 0
    ? mixHex(baseHex, '#ffffff', step * 0.06)
    : mixHex(baseHex, '#000000', -step * 0.06)
}

// Vit text som standard, mörk text bara för tydligt ljusa färger.
export function readableText(hex: string): string {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }) as [number, number, number]
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.6 ? '#1a1a1a' : '#ffffff'
}
