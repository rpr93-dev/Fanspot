/**
 * Next.js instrumentation hook: runs once when the server boots.
 *
 * Kicks off the prop-model cache warm-up in the background so the first
 * "Run model" click doesn't have to download the nflverse weekly files
 * inside the API timeout (D11 cold start).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { warmPropModel } = await import('@/lib/propModel')
  warmPropModel()
}
