import { NextRequest, NextResponse } from 'next/server'
import { getCached, setCached, isFresh } from '@/lib/cache/cacheService'
import { isValidStreamSource, isValidStreamId, type StreamOption } from '@/lib/streams'

/**
 * GET /api/streams/embed?source=delta&id=<match-source-id>
 *   Resolves a match source to playable embed options (language, HD,
 *   viewers). Source/id are charset-validated so this can't be used as an
 *   open proxy — only Streamed stream endpoints are ever fetched.
 */

const STREAMED = 'https://streamed.pk'
const TTL_MS = 60_000

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url)
  const source = url.searchParams.get('source') ?? ''
  const id = url.searchParams.get('id') ?? ''
  if (!isValidStreamSource(source) || !isValidStreamId(id)) {
    return NextResponse.json(
      { error: 'INVALID_PARAM', message: 'source and id must be valid Streamed identifiers' },
      { status: 400 },
    )
  }

  const key = `streams:embed:${source}:${id}`
  const cached = getCached<StreamOption[]>(key)
  if (cached && isFresh(cached.ts, TTL_MS)) {
    return NextResponse.json({ streams: cached.data, cached: true })
  }

  try {
    const res = await fetch(`${STREAMED}/api/stream/${source}/${id}`, {
      signal: AbortSignal.timeout(20000),
    })
    if (res.status === 404) {
      return NextResponse.json(
        { error: 'STREAMS_NOT_FOUND', message: 'No streams listed for this match right now.' },
        { status: 404 },
      )
    }
    if (!res.ok) throw new Error(`Streamed ${res.status}`)
    const body = await res.json()
    if (!Array.isArray(body)) throw new Error('Streamed bad shape')
    const streams: StreamOption[] = body
      .filter((s: any) => typeof s?.embedUrl === 'string' && s.embedUrl.startsWith('https://'))
      .map((s: any) => ({
        id: typeof s.id === 'string' ? s.id : id,
        streamNo: typeof s.streamNo === 'number' ? s.streamNo : 0,
        language: typeof s.language === 'string' ? s.language : 'Unknown',
        hd: s.hd === true,
        embedUrl: s.embedUrl,
        source,
        originId: id,
        viewers: typeof s.viewers === 'number' ? s.viewers : undefined,
      }))
      .slice(0, 24)
    setCached(key, streams)
    return NextResponse.json({ streams, cached: false })
  } catch (err) {
    return NextResponse.json(
      { error: 'STREAMS_UNAVAILABLE', message: 'Streams are down right now — try again in a bit.' },
      { status: 502 },
    )
  }
}
