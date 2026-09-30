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

// Maskinläsbar felkod från serverns `data.code` (t.ex. 'no_resource').
export function errorCode(err: unknown): string | null {
  const body = (err as { data?: unknown } | null | undefined)?.data as NitroErrorBody | undefined
  const nested = body && typeof body === 'object' ? (body.data as { code?: unknown } | undefined) : undefined
  if (nested && typeof nested === 'object' && typeof nested.code === 'string') return nested.code
  const direct = body && typeof body === 'object' ? (body as { code?: unknown }).code : undefined
  return typeof direct === 'string' ? direct : null
}

// Fel från useApi() – bär med HTTP-status och ev. felkod så att vyer kan
// skilja t.ex. 404 och "kontot saknar resurskoppling" från övriga fel.
export class ApiError extends Error {
  status: number | null
  code: string | null
  constructor(message: string, status: number | null, code: string | null) {
    super(message)
    this.status = status
    this.code = code
  }
}
