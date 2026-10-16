// Gemensamma hjälpare för PDF-generering med pdf-lib (fakturering och
// egenkontroller). Standardfonten Helvetica (WinAnsi) täcker å/ä/ö/é; tecken
// utanför teckenuppsättningen ersätts. Nitro-fri.

import type { PDFFont } from 'pdf-lib'

export const PDF_A4: [number, number] = [595.28, 841.89]

/** `keepNewlines`: behåll radbrytningar (för pdfWrap); annars ersätts de som övriga tecken utanför fonten. */
export function pdfSanitizer(font: PDFFont, opts: { keepNewlines?: boolean } = {}) {
  const allowed = new Set(font.getCharacterSet())
  const map: Record<string, string> = { '\u2212': '-', '\u00a0': ' ', '\u202f': ' ', '\u2009': ' ', '\t': ' ' }
  if (opts.keepNewlines) map['\r'] = ''
  return (s: string | null | undefined): string => {
    if (!s) return ''
    let out = ''
    for (const ch of s.normalize('NFC')) {
      const c = map[ch] ?? ch
      if (c === '\n' && opts.keepNewlines) {
        out += c
        continue
      }
      out += allowed.has(c.codePointAt(0)!) ? c : '?'
    }
    return out
  }
}

/** Radbrytning på ord; ord längre än kolumnen bryts per tecken. */
export function pdfWrap(font: PDFFont, s: string, size: number, width: number): string[] {
  const out: string[] = []
  for (const para of s.split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const cand = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(cand, size) <= width) {
        line = cand
        continue
      }
      if (line) out.push(line)
      let w = word
      while (font.widthOfTextAtSize(w, size) > width && w.length > 1) {
        let i = w.length - 1
        while (i > 1 && font.widthOfTextAtSize(w.slice(0, i), size) > width) i--
        out.push(w.slice(0, i))
        w = w.slice(i)
      }
      line = w
    }
    out.push(line)
  }
  return out.length ? out : ['']
}
