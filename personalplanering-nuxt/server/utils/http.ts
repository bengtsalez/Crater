// Fel i samma anda som den gamla Express-appen: svensk text som klienten visar
// via `data.error`. `message` sätts också för läsbara serverloggar.
export function apiError(statusCode: number, message: string) {
  return createError({
    statusCode,
    message,
    data: { error: message },
  })
}
