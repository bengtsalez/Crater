const HEX_RE = /^#[0-9a-fA-F]{6}$/

export function resolveResourceCategory(type: string, category: unknown): string | null {
  return type === 'anstalld' ? (category as string) : null
}

export function resolveColor(color: unknown): string | null {
  return typeof color === 'string' && HEX_RE.test(color) ? color.toLowerCase() : null
}
