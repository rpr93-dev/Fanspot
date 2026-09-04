import { NextResponse } from 'next/server'
import { buildConciergeContext } from '@/lib/concierge'
import { generateAIAnalysis, AnalystUnavailableError } from '@/lib/services/aiService'
import { getCached, setCached, isFresh } from '@/lib/cache/cacheService'
import { TTL } from '@/lib/cache/ttl'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { sport, teamId, teamAbbreviation, pageType, focusAreas, eventId, style, customQuestion } = body

    if (!sport || !teamId || !teamAbbreviation || !pageType) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const resolvedFocus = focusAreas?.length ? focusAreas : []
    const resolvedStyle = style ?? 'Normal'
    const cacheKey = `concierge:${sport}:${teamId}:${pageType}:${resolvedFocus.sort().join(',')}:${resolvedStyle}:${customQuestion || 'none'}`

    const cached = getCached<string>(cacheKey)
    if (cached && isFresh(cached.ts, TTL.AI_RESPONSE)) {
      return NextResponse.json({ content: cached.data, fromCache: true }, {
        headers: { 'Cache-Control': 'public, s-maxage=300' },
      })
    }

    const origin = new URL(request.url).origin
    const context = await buildConciergeContext(
      { sport, teamId, teamAbbreviation, pageType, focusAreas: resolvedFocus, eventId },
      origin,
    )

    const content = await generateAIAnalysis(pageType, resolvedFocus, context, resolvedStyle, customQuestion)

    setCached(cacheKey, content)

    return NextResponse.json({ content, fromCache: false }, {
      headers: { 'Cache-Control': 'public, s-maxage=300' },
    })
  } catch (err) {
    // Every configured model attempt timed out or failed: a known degraded state the
    // client renders distinctly — not a raw 500 string dump into the output box.
    if (err instanceof AnalystUnavailableError) {
      console.warn('[concierge] analyst unavailable:', err.cause)
      return NextResponse.json(
        { error: 'analyst-unavailable', message: err.message },
        { status: 503 },
      )
    }
    console.error('[concierge] Error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
