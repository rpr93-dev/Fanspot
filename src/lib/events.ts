export const EVENT_TYPES = {
  GAME_STARTED: 'game:started',
  GAME_UPDATED: 'game:updated',
  GAME_ENDED: 'game:ended',
  ODDS_CHANGED: 'odds:changed',
  INJURY_UPDATED: 'injury:updated',
} as const

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES]

export interface LiveEvent {
  type: EventType
  sport: string
  teamId?: string
  eventId?: string
  timestamp: number
  data?: unknown
}

export interface EventSubscription {
  sport?: string
  teamId?: string
  eventId?: string
  types?: EventType[]
}

export function createEvent(
  type: EventType,
  data?: { sport?: string; teamId?: string; eventId?: string; payload?: unknown },
): LiveEvent {
  return {
    type,
    sport: data?.sport ?? '',
    teamId: data?.teamId,
    eventId: data?.eventId,
    timestamp: Date.now(),
    data: data?.payload,
  }
}

export function eventMatches(
  event: LiveEvent,
  subscription: EventSubscription,
): boolean {
  if (subscription.sport && event.sport !== subscription.sport) return false
  if (subscription.teamId && event.teamId !== subscription.teamId) return false
  if (subscription.eventId && event.eventId !== subscription.eventId) return false
  if (subscription.types && !subscription.types.includes(event.type)) return false
  return true
}
