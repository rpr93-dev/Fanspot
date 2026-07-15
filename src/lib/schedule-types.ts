export interface ScheduleValidation {
  valid: boolean
  errors: string[]
}

export function validateSchedule(events: any[], sport: string, teamAbbr: string): ScheduleValidation {
  const errors: string[] = []
  if (!events || events.length === 0) {
    return { valid: false, errors: ['No events returned'] }
  }

  const now = new Date()

  for (const e of events) {
    if (!e.id) errors.push('Event missing id')
    if (!e.date || isNaN(new Date(e.date).getTime())) errors.push(`Event ${e.id || '?'} has invalid date`)

    const comp = e.competitions?.[0]
    if (!comp) {
      errors.push(`Event ${e.id || '?'} missing competitions`)
      continue
    }

    const competitors = comp.competitors
    if (!competitors || competitors.length < 2) {
      errors.push(`Event ${e.id || '?'} has < 2 competitors`)
      continue
    }

    const team = competitors.find((c: any) => c.team?.abbreviation?.toUpperCase() === teamAbbr.toUpperCase())
    if (!team) {
      errors.push(`Event ${e.id || '?'} does not include team ${teamAbbr}`)
    }

    if (new Date(e.date).getTime() > now.getTime()) {
      if (comp.status?.type?.completed) {
        errors.push(`Event ${e.id || '?'} is marked completed but date is in the future`)
      }
    }

    if (comp.status?.type?.completed && comp.status?.type?.state === 'pre') {
      errors.push(`Event ${e.id || '?'} is in preview state but marked completed`)
    }
  }

  const seen = new Set<string>()
  for (const e of events) {
    if (seen.has(e.id)) errors.push(`Duplicate event id: ${e.id}`)
    seen.add(e.id)
  }

  return { valid: errors.length === 0, errors }
}
