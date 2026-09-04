import { NextRequest, NextResponse } from 'next/server'
import { SUPPORTED_SPORTS, isFantasySportLive } from '@/lib/providers/fantasy-constants'
import { buildUnifiedDatabase, unifiedToFantasyPlayerEnriched } from '@/lib/fantasy/unified-db'
import { buildDraftPool, DEFAULT_MOCK_SETTINGS, MOCK_POSITIONS } from '@/lib/fantasy/mock-draft'
import { clampInt } from '@/lib/fantasy/clamp-int'
import type { StarterSlots } from '@/lib/fantasy/mock-draft'
import type { FantasySport, FantasyPlayerEnriched } from '@/lib/fantasy-types'

const SCORING_FORMATS: string[] = ['standard', 'ppr', 'half-ppr']
const ADP_PLATFORMS: string[] = ['espn', 'sleeper']

/** Range sanity limits for the per-position starter controls. */
const STARTER_LIMITS: Record<keyof StarterSlots, [number, number]> = {
  QB: [0, 6],
  RB: [0, 8],
  WR: [0, 10],
  TE: [0, 6],
  K: [0, 4],
  'D/ST': [0, 4],
  FLEX: [0, 6],
}

function parseStarters(url: URL): StarterSlots {
  const def = DEFAULT_MOCK_SETTINGS.starters
  const read = (key: keyof StarterSlots): number => {
    const raw = url.searchParams.get(key)
    if (raw == null) return def[key]
    const [min, max] = STARTER_LIMITS[key]
    return clampInt(raw, min, max, def[key])
  }
  return {
    QB: read('QB'),
    RB: read('RB'),
    WR: read('WR'),
    TE: read('TE'),
    K: read('K'),
    'D/ST': read('D/ST'),
    FLEX: read('FLEX'),
  }
}

/**
 * The pool a mock draft drafts from. The engine itself runs entirely client-side
 * (snake order, bot thinking, coach recommendations all happen in the browser), so the
 * route only needs to hand the room the same ranked, availability-gated player list the
 * Steals board uses — plus clamp the room settings the way the auction route clamps its
 * budget. Re-fetching mid-draft just returns the same pool, so the connection can be
 * refreshed without losing the board.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sport: string }> },
): Promise<NextResponse> {
  try {
    const { sport } = await params
    const lowerSport = sport.toLowerCase() as FantasySport

    if (!(SUPPORTED_SPORTS as readonly string[]).includes(lowerSport)) {
      return NextResponse.json(
        { error: `invalid-sport: ${sport}. Must be one of: ${SUPPORTED_SPORTS.join(', ')}` },
        { status: 400 },
      )
    }

    if (!isFantasySportLive(lowerSport)) {
      return NextResponse.json(
        {
          error: 'sport-not-available',
          sport: lowerSport,
          message: `Mock drafts for ${lowerSport.toUpperCase()} are not available yet.`,
        },
        { status: 501 },
      )
    }

    const url = new URL(req.url)
    const teams = clampInt(url.searchParams.get('teams'), 2, 20, DEFAULT_MOCK_SETTINGS.teams)
    const pick = clampInt(url.searchParams.get('pick'), 1, teams, DEFAULT_MOCK_SETTINGS.pick)
    const rosterSize = clampInt(
      url.searchParams.get('rosterSize'),
      12,
      24,
      DEFAULT_MOCK_SETTINGS.rosterSize,
    )
const scoringFormat = scoring(url.searchParams.get('scoring') ?? undefined)
const adpPlatform = (url.searchParams.get('adpPlatform') ?? 'espn') as 'espn' | 'sleeper'

if (!(ADP_PLATFORMS as readonly string[]).includes(adpPlatform)) {
      return NextResponse.json({ error: `invalid-adpPlatform: ${adpPlatform}` }, { status: 400 })
    }

    const season = Number(url.searchParams.get('season')) || undefined
    const db = await buildUnifiedDatabase({ season })
    const normalized = db.players.map(
      (u) => unifiedToFantasyPlayerEnriched(u) as unknown as FantasyPlayerEnriched,
    )

    const pool = buildDraftPool(normalized, { scoringFormat, adpPlatform })

    // The room never needs more prospects than the draft itself consumes plus a little
    // room for the coach to compare late-round calls against. Cap the wire payload so a
    // 24-team board does not ship the whole league everywhere.
    const MAX_POOL = Math.min(420, teams * rosterSize + 90)
    const capped = [...pool]
      .sort((a, b) => b.projection - a.projection)
      .slice(0, MAX_POOL)
    const counts = MOCK_POSITIONS.reduce<Record<string, number>>((acc, p) => {
      acc[p] = capped.filter((pl) => pl.pos === p).length
      return acc
    }, {})

    return NextResponse.json(
      {
        sport: lowerSport,
        settings: { teams, pick, rosterSize, scoringFormat, adpPlatform, starters: parseStarters(url) },
        pool: capped,
        counts,
        total: capped.length,
        generatedAt: new Date().toISOString(),
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600',
        },
      },
    )
  } catch (err) {
    console.error('[api/fantasy/mock-draft] error:', err)
    return NextResponse.json(
      { error: 'mock-draft-pool-failed', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

function scoring(value: string | undefined): 'ppr' | 'half-ppr' | 'standard' {
  if ((SCORING_FORMATS as readonly string[]).includes(value ?? '')) return value as 'ppr' | 'half-ppr' | 'standard'
  return 'ppr'
}