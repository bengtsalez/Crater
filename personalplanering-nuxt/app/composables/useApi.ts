import type { FetchError } from 'ofetch'

// Otypat $fetch – url:n är alltid en dynamisk sträng, så Nitros route-typinferens
// (som annars ger "excessive stack depth") ger inget värde här.
const rawFetch = $fetch as unknown as (
  request: string,
  opts?: Record<string, unknown>
) => Promise<unknown>

function messageFromError(err: unknown): string {
  const fe = err as FetchError
  return errorMessage(err, fe?.statusMessage || fe?.message || 'Ett fel uppstod.')
}

/**
 * $fetch-wrapper med samma beteende som gamla appens `api()`:
 * - 401 → skicka till /login och avbryt vidare bearbetning
 * - övriga fel → kasta Error med svensk text från svaret
 */
export function useApi() {
  async function api<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    body?: unknown
  ): Promise<T> {
    try {
      return (await rawFetch(url, {
        method,
        body: body as Record<string, unknown> | undefined,
      })) as T
    } catch (err) {
      const status = (err as FetchError)?.status ?? (err as FetchError)?.statusCode
      if (status === 401) {
        if (import.meta.client) {
          await navigateTo('/login')
        }
        // Stoppa vidare bearbetning tills omdirigeringen sker.
        return new Promise<T>(() => {})
      }
      throw new Error(messageFromError(err))
    }
  }

  return { api }
}
