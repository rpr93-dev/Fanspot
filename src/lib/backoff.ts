export async function withBackoff<T>(
  fn: () => Promise<T>,
  retries = 3,
  baseMs = 1000,
): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt === retries) throw err
      const isRateLimit =
        err instanceof Response
          ? err.status === 429
          : (err as any)?.status === 429 ||
            (err as any)?.message?.includes('429') ||
            (err as any)?.message?.includes('rate')
      const delay = isRateLimit
        ? Math.pow(2, attempt) * baseMs * 2
        : Math.pow(2, attempt) * baseMs
      if (isRateLimit) {
        console.warn(`[rate-limit] attempt ${attempt + 1}/${retries}, backing off ${delay}ms`)
      }
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw new Error('Unreachable')
}
