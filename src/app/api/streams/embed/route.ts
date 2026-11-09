import { NextRequest, NextResponse } from 'next/server'
import { getCached, setCached, isFresh } from '@/lib/cache/cacheService'
import { isValidStreamSource, isValidStreamId, type StreamOption } from '@/lib/streams'

/**
 * GET /api/streams/embed?source=fhd&id=<stream-key>
 *   Resolves a StreamFree stream_key to its playable quality variants. Source
 *   (a quality label) and id are charset-validated so this can't be used as an
 *   open proxy — only StreamFree source endpoints are ever fetched. The
 *   requested quality is ordered first; every other variant is still returned
 *   so the player can offer the full quality picker.
 */

const STREAMFREE = 'https://streamfree.top'
const TTL_MS = 60_000

function toOptions(raw: unknown, id: string, startAt: number): StreamOption[] {
  if (!Array.isArray(raw)) return []
  const out: StreamOption[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const { quality, url } = item as { quality?: unknown; url?: unknown }
    if (typeof quality !== 'string' || typeof url !== 'string') continue
    if (!url.startsWith('https://')) continue
    const label = quality.trim().toUpperCase()
    if (!label) continue
    const source = label.toLowerCase()
    out.push({
      id: `${id}:${source}`,
      streamNo: startAt + out.length + 1,
      language: label,
      hd: label !== 'SD',
      embedUrl: url,
      source,
      originId: id,
    })
  }
  return out
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url)
  const source = (url.searchParams.get('source') ?? '').toLowerCase()
  const id = url.searchParams.get('id') ?? ''
  if (!isValidStreamSource(source) || !isValidStreamId(id)) {
    return NextResponse.json(
      { error: 'INVALID_PARAM', message: 'source and id must be valid StreamFree identifiers' },
      { status: 400 },
    )
  }

  const key = `streams:embed:${source}:${id}`
  const cached = getCached<StreamOption[]>(key)
  if (cached && isFresh(cached.ts, TTL_MS)) {
    return NextResponse.json({ streams: cached.data, cached: true })
  }

  try {
    const res = await fetch(`${STREAMFREE}/api/v1/sources/${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(20000),
    })
    if (res.status === 404) {
      return NextResponse.json(
        { error: 'STREAMS_NOT_FOUND', message: 'No streams listed for this match right now.' },
        { status: 404 },
      )
    }
    if (!res.ok) throw new Error(`StreamFree ${res.status}`)
    const body = await res.json()
    // `sources` always carries the FHD/SD embeds; `live_sources` can add a
    // variant that has just gone live, so union both and de-dupe by URL.
    const seen = new Set<string>()
    const all = [...toOptions(body?.sources, id, 0), ...toOptions(body?.live_sources, id, 0)].filter(
      (o) => {
        if (seen.has(o.embedUrl)) return false
        seen.add(o.embedUrl)
        return true
      },
    )
    // Requested quality first, then the provider's own ordering.
    const streams = [...all.filter((o) => o.source === source), ...all.filter((o) => o.source !== source)]
      .slice(0, 24)
      .map((o, i) => ({ ...o, streamNo: i + 1 }))
    setCached(key, streams)
    return NextResponse.json({ streams, cached: false })
  } catch (err) {
    return NextResponse.json(
      { error: 'STREAMS_UNAVAILABLE', message: 'Streams are down right now — try again in a bit.' },
      { status: 502 },
    )
  }
}
