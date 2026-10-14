/**
 * Split-screen (multiview) helpers: selecting up to MAX_MULTIVIEW_SLOTS games
 * to watch side by side, serialized into the URL so a layout is shareable.
 *
 * A slot is `sport:eventId` where sport is a lowercase watch sport
 * (`nfl|nba|nhl|mlb`) and eventId is the ESPN event id. The special eventId
 * `redzone` on `nfl` selects the NFL RedZone channel instead of one game.
 */

import { isValidWatchSport, type WatchSport } from './streams'

export const MAX_MULTIVIEW_SLOTS = 4

export const REDZONE_SLOT_ID = 'redzone'

const EVENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9\-_]{0,63}$/

export interface MultiviewSlot {
  sport: WatchSport
  eventId: string
}

export function isRedzoneSlot(slot: MultiviewSlot): boolean {
  return slot.sport === 'nfl' && slot.eventId === REDZONE_SLOT_ID
}

export function slotKey(slot: MultiviewSlot): string {
  return `${slot.sport}:${slot.eventId}`
}

function parseOne(raw: string): MultiviewSlot | null {
  const part = raw.trim().toLowerCase()
  const sep = part.indexOf(':')
  if (sep <= 0) return null
  const sport = part.slice(0, sep)
  const eventId = part.slice(sep + 1)
  if (!isValidWatchSport(sport)) return null
  if (eventId !== REDZONE_SLOT_ID && !EVENT_ID_RE.test(eventId)) return null
  return { sport, eventId }
}

/**
 * Parse a `games` query value (`nfl:123,nba:456`) into slots. Invalid entries
 * are dropped, duplicates collapsed, and the list capped at MAX slots.
 */
export function parseMultiviewParam(param: string | null | undefined): MultiviewSlot[] {
  if (!param) return []
  const out: MultiviewSlot[] = []
  const seen = new Set<string>()
  for (const raw of param.split(',')) {
    const slot = parseOne(raw)
    if (!slot) continue
    const key = slotKey(slot)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(slot)
    if (out.length >= MAX_MULTIVIEW_SLOTS) break
  }
  return out
}

export function serializeMultiviewSlots(slots: MultiviewSlot[]): string {
  return slots.map(slotKey).join(',')
}

/** Shareable href for a slot selection. */
export function multiviewHref(slots: MultiviewSlot[]): string {
  const q = serializeMultiviewSlots(slots)
  return q ? `/multiview?games=${encodeURIComponent(q)}` : '/multiview'
}

/** Add a slot: no-op on duplicates, drops the add when already full. */
export function addMultiviewSlot(slots: MultiviewSlot[], slot: MultiviewSlot): MultiviewSlot[] {
  const key = slotKey(slot)
  if (slots.some((s) => slotKey(s) === key)) return slots
  if (slots.length >= MAX_MULTIVIEW_SLOTS) return slots
  return [...slots, slot]
}

export function removeMultiviewSlot(slots: MultiviewSlot[], index: number): MultiviewSlot[] {
  return slots.filter((_, i) => i !== index)
}

/** Responsive grid classes for the tile board. */
export function multiviewGridClass(count: number): string {
  if (count <= 1) return 'grid gap-4 grid-cols-1'
  return 'grid gap-4 grid-cols-1 xl:grid-cols-2'
}
