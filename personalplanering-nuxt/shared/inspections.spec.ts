import { describe, expect, it } from 'vitest'
import {
  EMPTY_ANSWER,
  evaluateItem,
  formatAnswerValue,
  INSPECTION_TRANSITIONS,
  InspectionValidationError,
  summarizeProjectInspections,
  validateTemplateContent,
  type AnswerValue,
  type ItemRequirements,
} from './inspections'
import { EXAMPLE_TEMPLATES } from './inspectionExamples'

const req = (o: Partial<ItemRequirements> = {}): ItemRequirements => ({
  answer_type: 'result',
  required: true,
  min_photos: 0,
  comment_required: false,
  ...o,
})
const ans = (o: Partial<AnswerValue>): AnswerValue => ({ ...EMPTY_ANSWER, ...o })

describe('evaluateItem', () => {
  it('obesvarad är aldrig godkänd', () => {
    expect(evaluateItem(req(), null, 0)).toEqual({ answered: false, complete: false, problems: ['Obesvarad'] })
    expect(evaluateItem(req({ required: false }), null, 0).complete).toBe(true)
    expect(evaluateItem(req({ answer_type: 'checkbox' }), ans({ checked: false }), 0).answered).toBe(false)
  })

  it('avvikelse kräver beskrivning, ej tillämplig kräver motivering', () => {
    expect(evaluateItem(req(), ans({ result: 'deviation' }), 0).problems).toContain('Avvikelse kräver beskrivning')
    expect(evaluateItem(req(), ans({ result: 'deviation', comment: 'Spricka' }), 0).complete).toBe(true)
    expect(evaluateItem(req(), ans({ result: 'na' }), 0).problems).toEqual(['Ej tillämplig kräver motivering'])
  })

  it('foto- och kommentarskrav, och att ej tillämplig ersätter dem', () => {
    const r = req({ min_photos: 2, comment_required: true })
    expect(evaluateItem(r, ans({ result: 'ok' }), 1).problems).toEqual(['Kommentar krävs', 'Minst 2 bilder krävs (1 uppladdade)'])
    expect(evaluateItem(r, ans({ result: 'ok', comment: 'ok' }), 2).complete).toBe(true)
    expect(evaluateItem(r, ans({ result: 'na', na_reason: 'Ingen fasad här' }), 0).complete).toBe(true)
  })

  it('svarstyper', () => {
    expect(evaluateItem(req({ answer_type: 'number' }), ans({ number_value: '0' }), 0).complete).toBe(true)
    expect(evaluateItem(req({ answer_type: 'number' }), ans({ number_value: '' }), 0).complete).toBe(false)
    expect(evaluateItem(req({ answer_type: 'text' }), ans({ text_value: '  ' }), 0).complete).toBe(false)
    expect(evaluateItem(req({ answer_type: 'date' }), ans({ date_value: '2026-10-16' }), 0).complete).toBe(true)
    expect(evaluateItem(req({ answer_type: 'number' }), ans({ result: 'deviation', comment: 'Fel nivå' }), 0).complete).toBe(true)
  })
})

describe('statusregler', () => {
  it('godkännande kan bara ske från inlämnad', () => {
    expect(INSPECTION_TRANSITIONS.approve.from).toEqual(['submitted'])
    expect(INSPECTION_TRANSITIONS.submit.from).not.toContain('approved')
    expect(INSPECTION_TRANSITIONS.archive.from).not.toContain('archived')
  })

  it('projekt utan kontroller är "ingen kontroll", aldrig klart', () => {
    expect(summarizeProjectInspections([]).state).toBe('none')
    expect(summarizeProjectInspections([{ status: 'approved', open_deviations: 0 }]).state).toBe('approved')
    expect(summarizeProjectInspections([{ status: 'approved', open_deviations: 0 }, { status: 'draft', open_deviations: 0 }]).state).toBe('unanswered')
    expect(summarizeProjectInspections([{ status: 'submitted', open_deviations: 1 }]).state).toBe('open_deviations')
  })
})

describe('mallvalidering', () => {
  it('normaliserar punkter och kräver rubrik', () => {
    const c = validateTemplateContent({
      name: ' Fasad ',
      sections: [{ title: 'A', items: [{ title: 'P', answer_type: 'number', unit: 'mm', min_photos: '2' }] }],
    })
    expect(c.name).toBe('Fasad')
    expect(c.kind).toBe('self_inspection')
    expect(c.sections[0]!.items[0]).toMatchObject({ unit: 'mm', min_photos: 2, required: true })
    expect(c.sections[0]!.items[0]!.key).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(() => validateTemplateContent({ name: '', sections: [] })).toThrow(InspectionValidationError)
    expect(() => validateTemplateContent({ name: 'x', sections: [{ items: [{ title: '' }] }] })).toThrow(/Rubrik/)
    expect(() => validateTemplateContent({ name: 'x', sections: [] }, { requireItems: true })).toThrow(/minst en/)
  })

  it('länkar till underlag måste vara http(s)', () => {
    const mk = (basis_url: string) => validateTemplateContent({ name: 'x', sections: [{ items: [{ title: 'p', basis_url }] }] })
    expect(mk('https://example.com/ritning.pdf').sections[0]!.items[0]!.basis_url).toBe('https://example.com/ritning.pdf')
    expect(() => mk('javascript:alert(1)')).toThrow(/http/)
    expect(() => mk('inte en länk')).toThrow(/ogiltig/)
  })

  it('dubbla nycklar får nya nycklar', () => {
    const c = validateTemplateContent({ name: 'x', sections: [{ items: [{ key: 'a', title: '1' }, { key: 'a', title: '2' }] }] })
    const keys = c.sections[0]!.items.map((i) => i.key)
    expect(new Set(keys).size).toBe(2)
  })

  it('exempelmallarna är giltiga och märkta som underlag att anpassa', () => {
    expect(EXAMPLE_TEMPLATES.map((t) => t.example_key)).toEqual(['drainage_v1', 'facade_v1', 'paving_v1', 'site_setup_v1'])
    for (const t of EXAMPLE_TEMPLATES) {
      expect(() => validateTemplateContent(t, { requireItems: true })).not.toThrow()
      expect(t.description).toMatch(/anpassa/)
    }
  })
})

describe('formatAnswerValue', () => {
  it('visar svar på svenska', () => {
    expect(formatAnswerValue({ answer_type: 'number', unit: 'm' }, ans({ number_value: '1.25' }))).toBe('1,25 m')
    expect(formatAnswerValue({ answer_type: 'result', unit: null }, ans({ result: 'ok' }))).toBe('Godkänd')
    expect(formatAnswerValue({ answer_type: 'checkbox', unit: null }, null)).toBe('Obesvarad')
    expect(formatAnswerValue({ answer_type: 'number', unit: 'm' }, ans({ number_value: '3', result: 'deviation' }))).toBe('3 m – Avvikelse')
  })
})
