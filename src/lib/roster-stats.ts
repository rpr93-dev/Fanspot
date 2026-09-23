export const teamStatLabels: Record<string, string> = {
  totalFirstDowns: '1st Downs', firstDownRushing: 'Rush 1st', firstDownPassing: 'Pass 1st', firstDownPenalty: 'Penalty 1st',
  // Real ESPN football team-stat keys (site v2 summary endpoint)
  firstDowns: '1st Downs', firstDownsRushing: 'Rush 1st', firstDownsPassing: 'Pass 1st', firstDownsPenalty: 'Penalty 1st',
  thirdDownEff: '3rd Down', fourthDownEff: '4th Down', redZoneAttempts: 'Red Zone',
  totalOffensivePlays: 'Off Plays', totalDrives: 'Drives', yardsPerPlay: 'Yds/Play',
  completionAttempts: 'Comp/Att', yardsPerPass: 'Yds/Pass', sacksYardsLost: 'Sacks-Yds',
  rushingAttempts: 'Rush Att', yardsPerRushAttempt: 'Yds/Rush',
  totalPenaltiesYards: 'Pen-Yds', fumblesLost: 'Fum Lost', defensiveTouchdowns: 'Def TD',
  totalYards: 'Total Yards', passingYards: 'Pass Yds', rushingYards: 'Rush Yds', netPassingYards: 'Pass Yds', grossPassingYards: 'Gross Pass',
  turnovers: 'TO', interceptionsThrown: 'INT', lostFumbles: 'Fum Lost', forcedFumbles: 'FF', fumblesRecovered: 'Fum Rec',
  tackles: 'Tackles', sacks: 'Sacks', interceptions: 'INT', safeties: 'Safeties',
  thirdDownEfficiency: '3rd Down', fourthDownEfficiency: '4th Down', redZoneEfficiency: 'Red Zone',
  penalties: 'Penalties', penaltyYards: 'Pen Yds', possessionTime: 'Possession',
  fieldGoalPct: 'FG%', threePointPct: '3P%', freeThrowPct: 'FT%',
  totalRebounds: 'REB', offensiveRebounds: 'OREB', defensiveRebounds: 'DREB',
  assists: 'AST', assistTurnoverRatio: 'A/TO', steals: 'STL', blocks: 'BLK', personalFouls: 'PF',
  points: 'PTS', fastBreakPoints: 'FB Pts', pointsInPaint: 'Paint Pts', secondChancePoints: '2nd Chance',
  fieldGoalsMade: 'FGM', fieldGoalsAttempted: 'FGA', threePointFieldGoalsMade: '3PM', threePointFieldGoalsAttempted: '3PA',
  freeThrowsMade: 'FTM', freeThrowsAttempted: 'FTA',
  shotsOnGoal: 'SOG', faceoffWinPct: 'FO%', powerPlayPct: 'PP%', penaltyMinutes: 'PIM',
  blockedShots: 'Blk', hits: 'Hits', giveaways: 'GA', takeaways: 'TK',
  powerPlayGoals: 'PPG', powerPlayOpportunities: 'PPO', shortHandedGoals: 'SHG',
  penaltyKillPct: 'PK%', shots: 'Shots',
  atBats: 'AB', runs: 'R', runsBattedIn: 'RBI', homeRuns: 'HR',
  walks: 'BB', strikeouts: 'K', battingAvg: 'AVG', onBasePct: 'OBP', sluggingPct: 'SLG', ops: 'OPS',
  stolenBases: 'SB', caughtStealing: 'CS', errors: 'E', putOuts: 'PO', doublePlays: 'DP',
  fieldingPct: 'FLD%', inningsPitched: 'IP', earnedRuns: 'ER', era: 'ERA', whip: 'WHIP',
  pitchesThrown: 'Pitches', strikesThrown: 'Strikes',
}

export const playerStatLabels: Record<string, string> = {
  G: 'Goals', A: 'Assists', PTS: 'Points', P: 'Points',
  SOG: 'SOG', S: 'Shots', TOI: 'TOI',
  PPTOI: 'PP TOI', SHTOI: 'SH TOI', ESTOI: 'EV TOI', EVTOI: 'EV TOI',
  BS: 'Blk Shots', BLK: 'Blocks', HT: 'Hits', HIT: 'Hits',
  TK: 'Takeaways', GV: 'Giveaways',
  FW: 'FOW', FL: 'FOL',
  SHFT: 'Shifts', SM: 'Missed', PN: 'Penalties', PIM: 'PIM',
  YTDG: 'GP',
  GA: 'GA', SA: 'SA', SV: 'Saves',
  SOS: 'SO Saves', SOSA: 'SO Att', ESSV: 'EV Saves', PPSV: 'PP Saves', SHSV: 'SH Saves',
  'H-AB': 'H/AB',
  MIN: 'Minutes', FG: 'FG', '3PT': '3PT', FT: 'FT',
  REB: 'Rebounds', AST: 'Assists', TO: 'Turnovers', STL: 'Steals',
  OREB: 'Off Reb', DREB: 'Def Reb', PF: 'Fouls',
}

export const sportPositionOrder: Record<string, string[]> = {
  NFL: ['QB', 'RB', 'FB', 'WR', 'TE', 'OT', 'OG', 'C', 'DE', 'DT', 'NT', 'OLB', 'MLB', 'ILB', 'LB', 'CB', 'S', 'SS', 'FS', 'K', 'PK', 'P', 'LS'],
  NBA: ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C'],
  NHL: ['C', 'LW', 'RW', 'F', 'D', 'G'],
  MLB: ['SP', 'RP', 'P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'OF', 'IF', 'DH'],
}

/** One roster column: `key` is the ESPN core-API season stat name. */
export interface RosterStatColumn {
  key: string
  label: string
}

const col = (key: string, label: string): RosterStatColumn => ({ key, label })

const NFL_DEF = [col('soloTackles', 'SOLO'), col('assistTackles', 'AST'), col('sacks', 'SACK'), col('tacklesForLoss', 'TFL')]
const NFL_LB = [...NFL_DEF, col('QBHits', 'QBHIT'), col('passesDefended', 'PD')]
const NFL_DB = [col('soloTackles', 'SOLO'), col('assistTackles', 'AST'), col('interceptions', 'INT'), col('passesDefended', 'PD'), col('fumblesForced', 'FF')]
const NFL_RB = [col('rushingAttempts', 'CAR'), col('rushingYards', 'YD'), col('rushingTouchdowns', 'TD'), col('receptions', 'REC'), col('receivingYards', 'REC YD')]
const NFL_REC = [col('receptions', 'REC'), col('receivingYards', 'YD'), col('receivingTargets', 'TGT'), col('receivingTouchdowns', 'TD')]
const NFL_K = [col('fieldGoalsMade', 'FGM'), col('fieldGoalAttempts', 'FGA'), col('extraPointsMade', 'XPM'), col('extraPointAttempts', 'XPA')]

const NFL_COLUMNS: Record<string, RosterStatColumn[]> = {
  QB: [col('completions', 'CMP'), col('passingAttempts', 'ATT'), col('passingYards', 'YD'), col('passingTouchdowns', 'TD'), col('interceptions', 'INT'), col('QBRating', 'RTG')],
  RB: NFL_RB, FB: NFL_RB,
  WR: NFL_REC, TE: NFL_REC,
  K: NFL_K, PK: NFL_K,
  P: [col('punts', 'PUNT'), col('puntYards', 'YD'), col('grossAvgPuntYards', 'AVG'), col('puntsInside20', 'IN20')],
  DE: NFL_DEF, DT: NFL_DEF, NT: NFL_DEF,
  OLB: NFL_LB, MLB: NFL_LB, ILB: NFL_LB, LB: NFL_LB,
  CB: NFL_DB, S: NFL_DB, SS: NFL_DB, FS: NFL_DB,
}

const NBA_COLUMNS = [
  col('avgPoints', 'PTS'), col('avgRebounds', 'REB'), col('avgAssists', 'AST'), col('avgSteals', 'STL'),
  col('avgBlocks', 'BLK'), col('avgMinutes', 'MIN'), col('fieldGoalPct', 'FG%'), col('threePointPct', '3P%'),
]
const NHL_SKATER_COLUMNS = [
  col('goals', 'G'), col('assists', 'A'), col('points', 'PTS'), col('plusMinus', '+/-'),
  col('shotsTotal', 'SOG'), col('timeOnIcePerGame', 'TOI'), col('penaltyMinutes', 'PIM'),
]
const NHL_GOALIE_COLUMNS = [
  col('wins', 'W'), col('losses', 'L'), col('avgGoalsAgainst', 'GAA'), col('savePct', 'SV%'), col('saves', 'SV'), col('shutouts', 'SO'),
]
const MLB_HITTER_COLUMNS = [
  col('avg', 'AVG'), col('homeRuns', 'HR'), col('RBIs', 'RBI'), col('runs', 'R'),
  col('onBasePct', 'OBP'), col('OPS', 'OPS'), col('stolenBases', 'SB'),
]
const MLB_PITCHER_COLUMNS = [
  col('ERA', 'ERA'), col('WHIP', 'WHIP'), col('wins', 'W'), col('losses', 'L'),
  col('saves', 'SV'), col('strikeouts', 'K'), col('innings', 'IP'),
]

export const MLB_PITCHER_POSITIONS = new Set(['P', 'SP', 'RP'])

/**
 * Season-stat columns for a roster row. Every sport goes through this one
 * schema so rows are column-aligned (missing values render as a dash) and
 * position groups get the stats that matter for them — hitters vs pitchers,
 * skaters vs goalies — instead of one mixed list.
 */
export function rosterStatColumns(sport: string, position: string): RosterStatColumn[] {
  const pos = position.toUpperCase()
  switch (sport.toUpperCase()) {
    case 'NFL': return NFL_COLUMNS[pos] ?? []
    case 'NBA': return NBA_COLUMNS
    case 'NHL': return pos === 'G' ? NHL_GOALIE_COLUMNS : NHL_SKATER_COLUMNS
    case 'MLB': return MLB_PITCHER_POSITIONS.has(pos) ? MLB_PITCHER_COLUMNS : MLB_HITTER_COLUMNS
    default: return []
  }
}
