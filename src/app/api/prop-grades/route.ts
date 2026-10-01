import { NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs/promises'
import { MODEL_DIR } from '@/lib/propModel'
import { gradeGame } from '@/lib/propGrades'

/**
 * Running grade of the prop model across every graded game in the ledger.
 *
 * GET /api/prop-grades
 *   -> { games, props, mae, picks, hits, pushes, hitRate, byGame: [...] }
 *
 * Scored at the frozen closing lines (the most recent book-line snapshot
 * before each game ended): projection error = |actual − projection|, picks
 * graded over/under vs the closing line. Games without a final box-score
 * point are not yet gradeable and are excluded.
 */

const LEDGER_PATH = path.join(MODEL_DIR, 'ledger', 'ledger.json')

export async function GET() {
  let ledger: { games?: Record<string, any> }
  try {
    ledger = JSON.parse(await fs.readFile(LEDGER_PATH, 'utf-8'))
    if (!ledger || typeof ledger !== 'object' || typeof ledger.games !== 'object') {
      return NextResponse.json({ games: 0, props: 0, mae: null, picks: 0, hits: 0, pushes: 0, hitRate: null, byGame: [] })
    }
  } catch {
    return NextResponse.json({ games: 0, props: 0, mae: null, picks: 0, hits: 0, pushes: 0, hitRate: null, byGame: [] })
  }

  const byGame: { key: string; eventDate: string; team: string; opponent: string; n: number; mae: number; picks: number; hits: number; pushes: number; hitRate: number | null }[] = []
  let errSum = 0
  let n = 0
  let hits = 0
  let pushes = 0
  let scored = 0
  for (const key of Object.keys(ledger.games ?? {}).sort()) {
    const game = ledger.games![key]
    const g = gradeGame(game)
    if (!g) continue
    byGame.push({
      key,
      eventDate: game?.eventDate,
      team: game?.team,
      opponent: game?.opponent,
      ...g,
    })
    errSum += g.mae * g.n
    n += g.n
    hits += g.hits
    pushes += g.pushes
    scored += g.picks - g.pushes
  }
  return NextResponse.json({
    games: byGame.length,
    props: n,
    mae: n ? errSum / n : null,
    picks: scored + pushes,
    hits,
    pushes,
    hitRate: scored ? hits / scored : null,
    byGame,
  })
}
