import { describe, expect, it } from 'vitest'
import { draftSumOre, newDraft, refreshPriceText, setPriceText, oreToInput, percentInput } from './billingDraft'

describe('billingDraft – momsväxling i formuläret', () => {
  it('pris inmatat inkl. moms lagras exkl. moms och växling ändrar inte priset', () => {
    const d = newDraft('inc')
    d.quantity = '2'
    setPriceText(d, '1 250', 'inc')
    expect(d.unit_price_ex_vat).toBe('1000')
    expect(draftSumOre(d, 'inc')).toBe(250000)
    expect(draftSumOre(d, 'ex')).toBe(200000)
    for (let i = 0; i < 10; i++) {
      refreshPriceText(d, 'ex')
      expect(d.price_text).toBe('1000,00')
      refreshPriceText(d, 'inc')
      expect(d.price_text).toBe('1250,00')
    }
    expect(d.unit_price_ex_vat).toBe('1000')
  })

  it('kronor och procent till inmatningstext', () => {
    expect(oreToInput(20000000)).toBe('200000')
    expect(oreToInput(12345)).toBe('123,45')
    expect(oreToInput(-5)).toBe('-0,05')
    expect(percentInput(3000)).toBe('30')
    expect(percentInput(3333)).toBe('33,33')
  })
})
