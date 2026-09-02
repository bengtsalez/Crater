// Plockar ut ett läsbart (svenskt) felmeddelande ur ett $fetch-fel.
//
// Nitros prod-felhandler svarar med formen
//   { error: true, statusCode, statusMessage, message, data: { error: '...' } }
// där `error` alltså är en boolean-flagga – INTE texten. Vår egen `apiError()`
// på servern lägger den läsbara texten i `data.error`. Läser man `data.error`
// rakt av (som inloggningssidan gjorde) hamnar boolean-flaggan i vyn och
// användaren ser bara "true".
interface NitroErrorBody {
  error?: unknown
  message?: unknown
  statusMessage?: unknown
  data?: { error?: unknown } | unknown
}

export function errorMessage(err: unknown, fallback: string): string {
  const body = (err as { data?: unknown } | null | undefined)?.data

  if (body && typeof body === 'object') {
    const b = body as NitroErrorBody

    // Serverns egen apiError() – den text vi faktiskt vill visa.
    const nested = b.data
    if (nested && typeof nested === 'object') {
      const nestedError = (nested as { error?: unknown }).error
      if (typeof nestedError === 'string' && nestedError) return nestedError
    }

    // Äldre/dev-form där texten ligger direkt på data.error.
    if (typeof b.error === 'string' && b.error) return b.error

    // Nitros message (t.ex. valideringsfel) – men inte den nedtystade "Server Error".
    if (typeof b.message === 'string' && b.message && b.message !== 'Server Error') {
      return b.message
    }
  }

  return fallback
}
