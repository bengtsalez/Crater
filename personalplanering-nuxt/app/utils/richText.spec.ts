import { describe, expect, it } from 'vitest'
import { parseRichText } from './richText'

describe('parseRichText', () => {
  it('delar upp i stycken på tomrad och behåller radbrytningar', () => {
    expect(parseRichText('Rad 1\nRad 2\n\nNytt stycke')).toEqual([
      { type: 'paragraph', lines: ['Rad 1', 'Rad 2'] },
      { type: 'paragraph', lines: ['Nytt stycke'] },
    ])
  })

  it('känner igen punkt- och numrerade listor', () => {
    expect(parseRichText('Ta med:\n- stege\n• skruv\n* borr\n\n1. Ring kund\n2) Lås upp')).toEqual([
      { type: 'paragraph', lines: ['Ta med:'] },
      { type: 'bullets', items: ['stege', 'skruv', 'borr'] },
      { type: 'numbered', items: ['Ring kund', 'Lås upp'] },
    ])
  })

  it('indragen rad fortsätter listpunkten', () => {
    expect(parseRichText('- första\n   fortsättning\n- andra')).toEqual([
      { type: 'bullets', items: ['första fortsättning', 'andra'] },
    ])
  })

  it('HTML behandlas som ren text', () => {
    const blocks = parseRichText('<script>alert(1)</script>\n<img src=x onerror=alert(1)>')
    expect(blocks).toEqual([{ type: 'paragraph', lines: ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>'] }])
  })

  it('hanterar tomt, null och Windows-radbrytningar', () => {
    expect(parseRichText(null)).toEqual([])
    expect(parseRichText('  \n\n ')).toEqual([])
    expect(parseRichText('a\r\nb')).toEqual([{ type: 'paragraph', lines: ['a', 'b'] }])
  })
})
