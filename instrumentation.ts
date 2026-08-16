/**
 * Pre-warm the fantasy unified database at server boot so the first steals /
 * mock-draft / auction request finds the cache warm instead of paying the full
 * Sleeper + ESPN + Vegas pipeline itself.
 *
 * Production only. In `next dev` the on-demand compiler gives lazily-compiled route
 * handlers their own module registry, so a boot-time build is invisible to them and
 * would just double-fetch the providers in parallel with the first request's build —
 * the routes already share one build among themselves via single-flight.
 */
export async function register() {
  if (process.env.NODE_ENV !== 'production') return
  // `register` also runs during `next build` for static generation; the fetches are
  // pointless there, so only pre-warm at real runtime.
  if (process.env.NEXT_PHASE === 'phase-production-build') return

  try {
    const { buildUnifiedDatabase } = await import('@/lib/fantasy/unified-db')
    void buildUnifiedDatabase().catch((err) => {
      console.warn(
        '[instrumentation] unified DB pre-warm failed — the first request will build it instead:',
        err instanceof Error ? err.message : String(err),
      )
    })
  } catch (err) {
    // Never let a pre-warm failure take the server down.
    console.warn('[instrumentation] pre-warm setup failed:', err instanceof Error ? err.message : String(err))
  }
}
