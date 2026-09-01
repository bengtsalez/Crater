export const DOW_LABELS = ['Mån', 'Tis', 'Ons', 'Tors', 'Fre', 'Lör', 'Sön']

export const MONTH_LABELS = [
  'Januari', 'Februari', 'Mars', 'April', 'Maj', 'Juni',
  'Juli', 'Augusti', 'September', 'Oktober', 'November', 'December',
]

// Fallback-palett för resurser utan egen vald färg. Deterministiskt index per resurs-id.
export const RESOURCE_PALETTE = [
  '#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300',
  '#4a3aa7', '#e34948', '#a7a932', '#88438e', '#790909', '#341f94',
]

export const TL_LABEL_WIDTH = 180
export const TL_DAY_WIDTH = 36
export const TL_VISIBLE_DAYS = 56

// Översikt/analytics: fönster (dagar framåt från idag) för respektive KPI.
export const ANALYTICS_UPCOMING_WINDOW_DAYS = 30
export const ANALYTICS_UNSTAFFED_LEAD_DAYS = 7

export const STATUS_LABELS: Record<string, string> = {
  aktiv: 'Aktiv',
  planerad: 'Planerad',
  avslutad: 'Avslutad',
}
