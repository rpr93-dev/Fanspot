import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { buildConciergeContext } from '@/lib/concierge'
import { generateAIAnalysis } from '@/lib/services/aiService'
import { getCached, setCachedChecked, isCachedFresh } from '@/lib/cache/cacheService'
import { TTL } from '@/lib/cache/ttl'
import { invalidParam, isAllowedSport, isValidEventId } from '@/lib/api-validation'
import { checkRateLimit } from '@/lib/rate-limit'

const PAGE_TYPES = ['team', 'next-game', 'past-game'] as const
const STYLES = ['Normal', 'Stephen A. Smith', 'Nick Wright', 'Skip Bayless', 'Pat McAfee', 'Bill Simmons'] as const

export const MAX_CUSTOM_QUESTION = 500
export const MAX_FOCUS_AREAS = 20
export const MAX_FOCUS_AREA_LEN = 100

function hashQuestion(q: string): string {
  return createHash('sha256').update(q).digest('hex').slice(0, 32)
}

export async function POST(request: Request) {
  const limited = checkRateLimit(request, 'concierge')
  if (limited) return limited

  try {
    const body = await request.json()
    const { sport, teamId, teamAbbreviation, pageType, focusAreas, eventId, style, customQuestion } = body

    if (!sport || !teamId || !teamAbbreviation || !pageType) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    if (!isAllowedSport(sport)) {
      return invalidParam('sport must be one of NFL, NBA, NHL, MLB')
    }
    if (!PAGE_TYPES.includes(pageType)) {
      return invalidParam('pageType must be one of team, next-game, past-game')
    }
    if (style != null && !STYLES.includes(style)) {
      return invalidParam('style must be one of the analyst styles')
    }
    if (eventId != null && eventId !== '' && !isValidEventId(String(eventId))) {
      return invalidParam('eventId must be numeric')
    }

    // focusAreas: required-array contract — absent means [], anything that is
    // not a (short) array of short strings is rejected outright.
    if (focusAreas != null) {
      if (!Array.isArray(focusAreas) || focusAreas.length > MAX_FOCUS_AREAS) {
        return invalidParam(`focusAreas must be an array of at most ${MAX_FOCUS_AREAS} items`)
      }
      if (focusAreas.some((f: unknown) => typeof f !== 'string' || f.length > MAX_FOCUS_AREA_LEN)) {
        return invalidParam(`focusAreas entries must be strings of at most ${MAX_FOCUS_AREA_LEN} characters`)
      }
    }
    // customQuestion: hard cap rather than silent truncation — the answer is
    // generated per exact question, so a silently-trimmed question would
    // confuse the user more than a 400 telling them to shorten it.
    if (customQuestion != null && typeof customQuestion !== 'string') {
      return invalidParam('customQuestion must be a string')
    }
    const question = typeof customQuestion === 'string' ? customQuestion.trim() : ''
    if (question.length > MAX_CUSTOM_QUESTION) {
      return invalidParam(`customQuestion must be at most ${MAX_CUSTOM_QUESTION} characters`)
    }

    const resolvedFocus = focusAreas?.length ? focusAreas : []
    const resolvedStyle = style ?? 'Normal'
    const cacheKey = `concierge:${sport}:${teamId}:${pageType}:${resolvedFocus.sort().join(',')}:${resolvedStyle}:${question ? hashQuestion(question) : 'none'}`

    const cached = getCached<string>(cacheKey)
    if (cached && isCachedFresh(cached, TTL.AI_RESPONSE)) {
      return NextResponse.json({ content: cached.data, fromCache: true }, {
        headers: { 'Cache-Control': 'private, no-store' },
      })
    }

    const origin = new URL(request.url).origin
    const context = await buildConciergeContext(
      { sport, teamId, teamAbbreviation, pageType, focusAreas: resolvedFocus, eventId },
      origin,
    )

    const content = await generateAIAnalysis(pageType, resolvedFocus, context, resolvedStyle, question || undefined)

    setCachedChecked(cacheKey, content)

    return NextResponse.json({ content, fromCache: false }, {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (err) {
    console.error('[concierge] Error:', err)
    return NextResponse.json(
      { error: 'ANALYSIS_FAILED', message: 'Failed to generate analysis' },
      { status: 500 },
    )
  }
}
