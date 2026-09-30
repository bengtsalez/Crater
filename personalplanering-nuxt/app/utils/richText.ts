// Ren text → block (stycken och listor) för säker rendering utan v-html.
// Projektledare klistrar in text från mejl/dokument; allt behandlas som text,
// så HTML/skript i inklistrat innehåll visas bokstavligt och körs aldrig.

export type RichBlock =
  | { type: 'paragraph'; lines: string[] }
  | { type: 'bullets'; items: string[] }
  | { type: 'numbered'; items: string[] }

const BULLET_RE = /^\s*[-*•–·]\s+(.*)$/
const NUMBER_RE = /^\s*\d{1,3}[.)]\s+(.*)$/

export function parseRichText(input: string | null | undefined): RichBlock[] {
  const blocks: RichBlock[] = []
  let current: RichBlock | null = null
  const flush = () => {
    if (current) blocks.push(current)
    current = null
  }
  for (const raw of (input ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim()) {
      flush()
      continue
    }
    const bullet = BULLET_RE.exec(line)
    const numbered = bullet ? null : NUMBER_RE.exec(line)
    if (bullet) {
      if (current?.type !== 'bullets') {
        flush()
        current = { type: 'bullets', items: [] }
      }
      current.items.push(bullet[1]!.trim())
    } else if (numbered) {
      if (current?.type !== 'numbered') {
        flush()
        current = { type: 'numbered', items: [] }
      }
      current.items.push(numbered[1]!.trim())
    } else if (current && current.type !== 'paragraph' && /^\s{2,}\S/.test(raw)) {
      // Indragen fortsättningsrad hör till föregående listpunkt.
      const items = current.items
      items[items.length - 1] += ' ' + line.trim()
    } else {
      if (current?.type !== 'paragraph') {
        flush()
        current = { type: 'paragraph', lines: [] }
      }
      current.lines.push(line.trim())
    }
  }
  flush()
  return blocks
}
