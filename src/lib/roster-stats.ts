export const teamStatLabels: Record<string, string> = {
  totalFirstDowns: '1st Downs', firstDownRushing: 'Rush 1st', firstDownPassing: 'Pass 1st', firstDownPenalty: 'Penalty 1st',
  totalYards: 'Total Yards', passingYards: 'Pass Yds', rushingYards: 'Rush Yds', netPassingYards: 'Net Pass', grossPassingYards: 'Gross Pass',
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
  NFL: ['QB', 'RB', 'FB', 'WR', 'TE', 'OT', 'OG', 'C', 'DE', 'DT', 'NT', 'OLB', 'MLB', 'ILB', 'LB', 'CB', 'S', 'SS', 'FS', 'K', 'P', 'LS'],
  NBA: ['PG', 'SG', 'SF', 'PF', 'C'],
  NHL: ['G', 'D', 'LW', 'C', 'RW'],
  MLB: ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'IF', 'OF'],
}

export const nflStatKey: Record<string, string> = {
  cmp: 'completions', att: 'passingAttempts', passYd: 'passingYards',
  passTd: 'passingTouchdowns', int: 'interceptions', qbr: 'QBRating',
  car: 'rushingAttempts', rushYd: 'rushingYards', rushTd: 'rushingTouchdowns',
  rec: 'receptions', recYd: 'receivingYards', tgt: 'receivingTargets',
  recTd: 'receivingTouchdowns', fgm: 'fieldGoalsMade', fga: 'fieldGoalsAttempted',
  xpm: 'kickExtraPointsMade', xpa: 'kickExtraPointsAttempted',
  solo: 'soloTackles', ast: 'assistTackles', sack: 'sacks',
  tfl: 'tacklesForLoss', qbHit: 'QBHits', defInt: 'interceptions',
  pd: 'passesDefensed', ff: 'forcedFumbles', fr: 'fumbleRecoveries',
  punt: 'punts', puntYd: 'puntYards', puntAvg: 'grossAvgPuntYards',
  puntIn20: 'puntsInside20',
}

const nflDefSchema = [
  { key: 'solo', label: 'SOLO' }, { key: 'ast', label: 'AST' },
  { key: 'sack', label: 'SACK' }, { key: 'tfl', label: 'TFL' },
]

export const nflStatSchema: Record<string, { key: string; label: string }[]> = {
  QB: [
    { key: 'cmp', label: 'CMP' }, { key: 'att', label: 'ATT' },
    { key: 'passYd', label: 'YD' }, { key: 'passTd', label: 'TD' },
    { key: 'int', label: 'INT' }, { key: 'qbr', label: 'QBR' },
  ],
  RB: [
    { key: 'car', label: 'CAR' }, { key: 'rushYd', label: 'YD' },
    { key: 'rushTd', label: 'TD' }, { key: 'rec', label: 'REC' },
    { key: 'recYd', label: 'REC YD' },
  ],
  FB: [
    { key: 'car', label: 'CAR' }, { key: 'rushYd', label: 'YD' },
    { key: 'rushTd', label: 'TD' }, { key: 'rec', label: 'REC' },
    { key: 'recYd', label: 'REC YD' },
  ],
  WR: [
    { key: 'rec', label: 'REC' }, { key: 'recYd', label: 'YD' },
    { key: 'tgt', label: 'TGT' }, { key: 'recTd', label: 'TD' },
  ],
  TE: [
    { key: 'rec', label: 'REC' }, { key: 'recYd', label: 'YD' },
    { key: 'tgt', label: 'TGT' }, { key: 'recTd', label: 'TD' },
  ],
  K: [
    { key: 'fgm', label: 'FGM' }, { key: 'fga', label: 'FGA' },
    { key: 'xpm', label: 'XPM' }, { key: 'xpa', label: 'XPA' },
  ],
  P: [
    { key: 'punt', label: 'PUNT' }, { key: 'puntYd', label: 'YD' },
    { key: 'puntAvg', label: 'AVG' }, { key: 'puntIn20', label: 'IN20' },
  ],
  DE: nflDefSchema, DT: nflDefSchema, NT: nflDefSchema,
  PK: [
    { key: 'fgm', label: 'FGM' }, { key: 'fga', label: 'FGA' },
    { key: 'xpm', label: 'XPM' }, { key: 'xpa', label: 'XPA' },
  ],
  OLB: [...nflDefSchema, { key: 'qbHit', label: 'QBHIT' }, { key: 'pd', label: 'PD' }],
  MLB: [...nflDefSchema, { key: 'qbHit', label: 'QBHIT' }, { key: 'pd', label: 'PD' }],
  ILB: [...nflDefSchema, { key: 'qbHit', label: 'QBHIT' }, { key: 'pd', label: 'PD' }],
  LB: [...nflDefSchema, { key: 'qbHit', label: 'QBHIT' }, { key: 'pd', label: 'PD' }],
  CB: [
    { key: 'solo', label: 'SOLO' }, { key: 'ast', label: 'AST' },
    { key: 'defInt', label: 'INT' }, { key: 'pd', label: 'PD' },
    { key: 'ff', label: 'FF' },
  ],
  S: [
    { key: 'solo', label: 'SOLO' }, { key: 'ast', label: 'AST' },
    { key: 'defInt', label: 'INT' }, { key: 'pd', label: 'PD' },
    { key: 'ff', label: 'FF' },
  ],
  SS: [
    { key: 'solo', label: 'SOLO' }, { key: 'ast', label: 'AST' },
    { key: 'defInt', label: 'INT' }, { key: 'pd', label: 'PD' },
    { key: 'ff', label: 'FF' },
  ],
  FS: [
    { key: 'solo', label: 'SOLO' }, { key: 'ast', label: 'AST' },
    { key: 'defInt', label: 'INT' }, { key: 'pd', label: 'PD' },
    { key: 'ff', label: 'FF' },
  ],
  OT: [], OG: [], C: [], LS: [],
}

export const relevantStats: Record<string, { label: string; key: string }[]> = {
  NBA: [
    { label: 'PTS', key: 'avgPoints' }, { label: 'AST', key: 'avgAssists' },
    { label: 'REB', key: 'avgRebounds' }, { label: 'STL', key: 'avgSteals' },
    { label: 'BLK', key: 'avgBlocks' }, { label: 'MIN', key: 'avgMinutes' },
    { label: 'FG%', key: 'fieldGoalPct' }, { label: '3P%', key: 'threePointPct' },
    { label: 'FT%', key: 'freeThrowPct' },
  ],
  NHL: [
    { label: 'G', key: 'goals' }, { label: 'A', key: 'assists' },
    { label: 'PTS', key: 'points' }, { label: '+/-', key: 'plusMinus' },
    { label: 'PIM', key: 'penaltyMinutes' }, { label: 'SOG', key: 'shotsOnGoal' },
    { label: 'TOI', key: 'timeOnIce' },
  ],
  MLB: [
    { label: 'AVG', key: 'battingAvg' }, { label: 'HR', key: 'homeRuns' },
    { label: 'RBI', key: 'runsBattedIn' }, { label: 'OBP', key: 'onBasePercentage' },
    { label: 'SLG', key: 'sluggingPercentage' }, { label: 'SB', key: 'stolenBases' },
    { label: 'ERA', key: 'era' }, { label: 'W', key: 'wins' },
    { label: 'L', key: 'losses' }, { label: 'SO', key: 'strikeouts' },
    { label: 'BB', key: 'walks' }, { label: 'SV', key: 'saves' },
  ],
}
