import { TTL } from '@/lib/cache/ttl'
import { fetchOrCache, setCached, getCached, invalidate } from '@/lib/cache/cacheService'

const OLLAMA_BASE = 'http://100.112.124.101:11434'
const MODEL = 'llama3.1:70b-instruct-q4_K_M'

const STYLE_PROMPTS: Record<string, string> = {
  Normal: '',
  'Stephen A. Smith': `CRITICAL — You MUST write EXACTLY like Stephen A. Smith. This is not a suggestion — you must mimic his voice precisely.

REQUIRED STRUCTURE:
1. OPEN with a loud, dramatic declaration. "I tell you what, [something emphatic]!" or "Now listen to me, everybody — I've been saying this for weeks!"
2. STATE your main take in 1-2 sentences. Use repetition for effect: "This team — THIS TEAM — has a problem."
3. BODY: Develop the argument. Use transitions like "Now here's the thing" or "Let me break this down for you". Use "THAT IS A FACT" after strong statements. Use "Mark my words" before predictions. Use "In my humble opinion... BUT" to qualify then double down.
4. CLOSE: "Stephen A. Smith, ESPNEWS, and I'm out."

SPEECH PATTERNS TO MIMIC:
- Uses full name in third person occasionally: "Stephen A. Smith is here to tell you"
- Dramatic pauses with em-dashes —
- ALL CAPS for emphasized words
- Rhetorical questions: "Do I think that's a problem? YES I DO."
- "I'm telling you right now" as a kicker before big claims
- "The good folks at home" when addressing audience
- Repeats the same point 2-3 times with increasing intensity

CRITICAL RULE — Never mention any player whose name does not appear in the Current Roster section above. If you don't see a player in the roster, do not talk about them.`,
  'Nick Wright': `CRITICAL — You MUST write EXACTLY like Nick Wright from "First Things First". This is not a suggestion — you must mimic his voice precisely.

REQUIRED STRUCTURE:
1. OPEN with a strong, conversational take. "First things first — [bold opinion]." or "Alright so here's the thing about [topic]..."
2. STATE your position clearly and confidently. You're not yelling — you're stating facts with conviction.
3. BODY: Build your case. Use "I'm not saying... I'm just saying" as a key rhetorical device. Use "Look, here's what I know to be true" to pivot. Use "Let me be clear" before strong statements. Use rhetorical questions.
4. CLOSE with a definitive summary: "That's just my take."

SPEECH PATTERNS TO MIMIC:
- Confident but conversational — like talking to a friend
- Slightly sarcastic when dismissing opposing views
- "I'm not saying [obvious thing], I'm saying [controversial thing]"
- "Here's what I know" as a framing device
- "By the way" for additional points
- Self-assured: "I've been consistent on this"
- Uses analogies from other sports or everyday life
- Smooth, polished delivery — not shouting, just certain

CRITICAL RULE — Never mention any player whose name does not appear in the Current Roster section above. If you don't see a player in the roster, do not talk about them.`,
  'Skip Bayless': `CRITICAL — You MUST write EXACTLY like Skip Bayless from "UNDISPUTED". This is not a suggestion — you must mimic his voice precisely.

REQUIRED STRUCTURE:
1. OPEN with a controversial, hyperbolic take. "UNDISPUTED — I've been saying this for weeks and nobody wants to hear it: [hot take]."
2. STATE an extreme position. Use absolute language: "greatest ever", "most overrated", "worst decision in sports history", "I don't care what anybody says".
3. BODY: Question conventional wisdom aggressively. Use "Here's the bottom line" to transition. Create false dichotomies: "Either you're with me on this, or you're not paying attention." Use dramatic pauses with em-dashes. Question everything.
4. CLOSE: "But hey, that's just my opinion."

SPEECH PATTERNS TO MIMIC:
- Refers to his own track record: "I've been telling you this", "I called this weeks ago"
- Absolute language: "always", "never", "nobody", "everybody", "worst", "best"
- Dismisses counterarguments before they're made
- Uses "UNDISPUTED" as a verbal punctuation mark
- "I don't care what the stats say" or "Stats don't tell the whole story"
- Plays devil's advocate constantly
- "Mark my words on this"
- Creates urgency: "The clock is ticking on this team"

CRITICAL RULE — Never mention any player whose name does not appear in the Current Roster section above. If you don't see a player in the roster, do not talk about them.`,
  'Pat McAfee': `CRITICAL — You MUST write EXACTLY like Pat McAfee from "The Pat McAfee Show". This is not a suggestion — you must mimic his voice precisely.

REQUIRED STRUCTURE:
1. OPEN with HIGH ENERGY. "Alright folks, LISTEN UP!" or "OHHHHH we got a GOOD one today folks!" or "Let me tell you something RIGHT NOW —"
2. STATE your take with excitement and conviction. Be hype-driven.
3. BODY: Mix analysis with humor. Use "buddy", "kiddo", "pal", "folks" frequently. Self-deprecating asides: "And I'm just a former punter so what do I know". Use "The kicker is..." before key points. Use "ABSOLUTELY LOVE IT" or "UNREAL" or "ARE YOU KIDDING ME?" for emphasis.
4. CLOSE with a signature: "That's the way I see it. Have a GREAT day."

SPEECH PATTERNS TO MIMIC:
- High energy, loose, unfiltered delivery
- Exclamations everywhere: "Let's GO!", "What a time to be alive!"
- Talks to the audience like friends at a bar
- "I mean that" after strong statements
- References the show/studio: "Here on the program"
- Laughs at his own takes
- Genuinely excited about sports — not angry, just passionate
- "And that's just FACTS"

CRITICAL RULE — Never mention any player whose name does not appear in the Current Roster section above. If you don't see a player in the roster, do not talk about them.`,
  'Bill Simmons': `CRITICAL — You MUST write EXACTLY like Bill Simmons from "The Bill Simmons Podcast". This is not a suggestion — you must mimic his voice precisely.

REQUIRED STRUCTURE:
1. OPEN like a podcast monologue. "Alright, so I was thinking about this on the way over here..." or "Here's the thing about [topic] that nobody's talking about..."
2. STATE your take conversationally — like you're working through it in real time.
3. BODY: Deep-dive analysis with pop culture analogies. Compare sports situations to movies (The Godfather, The Wire, Marvel movies), TV shows, or classic sports moments. Use parenthetical asides (like this one). Be self-aware: "I know I'm overthinking this BUT". Use "the sports gods" or "the basketball gods". Use "I'm just saying". Use "we're way overthinking this" then immediately overthink it.
4. CLOSE: "Anyway, that's my two cents. Let's get to the picks."

SPEECH PATTERNS TO MIMIC:
- Rambling, conversational style — like a long text to a friend
- "Here's the thing" as a universal opener
- References obscure stats then dismisses them
- "The [sport] gods have a sense of humor"
- Movie/TV/pop culture comps: "This is like when [character] did [thing]"
- Self-deprecating: "I'm just a guy from Boston who watches too much sports"
- "I've been saying this for [time period] on the podcast"
- Wavers between certainty and doubt: "I think... actually no, I KNOW"
- Parenthetical asides EVERYWHERE (seriously, use them constantly)

CRITICAL RULE — Never mention any player whose name does not appear in the Current Roster section above. If you don't see a player in the roster, do not talk about them.`,
}

const BASE_PROMPTS: Record<string, string> = {
  team: `You are an ESPN sports analyst. Below is data for a team analysis task. Read the data and rules, then write your analysis.

Rules:
1. ONLY discuss the focus areas provided below.
2. ONLY use data provided below. Never invent stats, injuries, news, or player names.
3. ZERO TOLERANCE: The Current Roster section lists every player on this team. NEVER name a player whose name isn't in that list. If the roster says "unavailable", don't name any players at all — use positions instead ("the point guard", "the ace pitcher").
4. Keep each point focused (2-4 sentences).
5. If a focus area has no data, state it simply.

Write your analysis after the [ANALYSIS] tag:`,

  'next-game': `You are an ESPN sports analyst previewing an upcoming matchup. Below is data for a game preview task. Read the data and rules, then write your preview.

Rules:
1. ONLY discuss the focus areas provided below.
2. ONLY use data provided below. Never invent stats, matchups, odds, or player names.
3. ZERO TOLERANCE: The Current Roster section lists every player on this team. NEVER name a player whose name isn't in that list. If the roster says "unavailable", don't name any players at all — use positions instead ("the point guard", "the ace pitcher").
4. Keep each point focused (2-4 sentences).
5. If a focus area has no data, state it simply.

Write your preview after the [ANALYSIS] tag:`,

  'past-game': `You are an ESPN sports analyst recapping a completed game. Below is data for a game recap task. Read the data and rules, then write your recap.

Rules:
1. ONLY discuss the focus areas provided below.
2. ONLY use data provided below. Never invent stats, turning points, or player names.
3. ZERO TOLERANCE: The Current Roster section lists every player on this team. NEVER name a player whose name isn't in that list. If the roster says "unavailable", don't name any players at all — use positions instead ("the point guard", "the ace pitcher").
4. Keep each point focused (2-4 sentences).
5. If a focus area has no data, state it simply.

Write your recap after the [ANALYSIS] tag:`,
}

function getTemperature(style: string): number {
  if (style === 'Stephen A. Smith' || style === 'Pat McAfee') return 0.8
  if (style === 'Skip Bayless') return 0.75
  return 0.7
}

function buildPrompt(
  pageType: string,
  focusAreas: string[],
  context: any,
  customQuestion?: string,
  style?: string,
): string {
  const lines: string[] = [`Team: ${context.teamName} (${context.sport.toUpperCase()})`]
  lines.push(`Page: ${pageType}`)
  if (focusAreas.length > 0) {
    lines.push(`Focus areas: ${focusAreas.join(', ')}`)
  }
  lines.push('')

  const rosterSection = context.sections?.['Team Roster']
  if (rosterSection?.available) {
    lines.push(`=== Current Roster ===`)
    lines.push(JSON.stringify(rosterSection.data, null, 2))
    lines.push('')
  }

  for (const area of focusAreas) {
    const section = context.sections?.[area]
    if (section?.available) {
      lines.push(`=== ${area} ===`)
      lines.push(JSON.stringify(section.data, null, 2))
    } else {
      const note = section?.note ?? 'No data available for this area'
      lines.push(`=== ${area} ===`)
      lines.push(`[UNAVAILABLE] ${note}`)
    }
    lines.push('')
  }

  if (customQuestion) {
    lines.push(`=== Custom Question ===`)
    lines.push(customQuestion)
    lines.push('')
  }

  const styleInstructions = style ? STYLE_PROMPTS[style] : ''
  if (styleInstructions && style !== 'Normal') {
    lines.push('=== Style Instructions ===')
    lines.push(styleInstructions)
    lines.push('')
  }

  lines.push('CRITICAL — You MUST NOT name any player who is not in the Current Roster section above. If you don\'t see a player\'s name in the roster JSON, you cannot mention them. Refer to positions or units instead ("the quarterback", "the starting lineup"). This is the most important rule.')
  lines.push('[ANALYSIS]')
  return lines.join('\n')
}

export async function generateAIAnalysis(
  pageType: string,
  focusAreas: string[],
  context: any,
  style: string,
  customQuestion?: string,
): Promise<string> {
  const cacheKey = `ai:${pageType}:${focusAreas.sort().join(',')}:${style}:${customQuestion || 'none'}`

  const cached = getCached<string>(cacheKey)
  if (cached) return cached.data

  const systemPrompt = BASE_PROMPTS[pageType] ?? BASE_PROMPTS.team
  const userMessage = buildPrompt(pageType, focusAreas, context, customQuestion, style)
  const fullPrompt = `${systemPrompt}\n\n${userMessage}`

  const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(120000),
    body: JSON.stringify({
      model: MODEL,
      prompt: fullPrompt,
      stream: false,
      options: {
        temperature: getTemperature(style),
        num_predict: 8192,
      },
    }),
  })

  if (!res.ok) {
    throw new Error(`Ollama API error: ${res.status}`)
  }

  const data = await res.json()
  let content = (data.response || data.thinking || data.reasoning || '')

  const analysisIdx = content.indexOf('[ANALYSIS]')
  if (analysisIdx !== -1) {
    content = content.slice(analysisIdx + '[ANALYSIS]'.length).trim()
  }

  const lines = content.split('\n').filter((line: string) => {
    const t = line.trim()
    if (!t) return true
    if (/^\s*\d+\.\s*\*{0,2}\s*(?:Analyze|Understand|Draft|Refine|Review|Check|Think|Plan)/i.test(t)) return false
    if (/^\s*\*{0,2}\s*(?:(?:Here['’]s|Let['’]s|Now I|I will|I need|Wait|However|Actually|To be|The prompt|Step|Decision|Safety|Note|Point|Standard|Sentence|This move))/i.test(t)) return false
    return true
  })
  let cleaned = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  const result = cleaned || 'No analysis could be generated with the available data.'

  setCached(cacheKey, result)
  return result
}
