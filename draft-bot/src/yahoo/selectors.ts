import type { Page, Locator } from 'playwright'

/**
 * Every DOM interaction goes through this selector table. Yahoo's draft client has
 * no public DOM contract, so the defaults here are educated guesses, each entry is a
 * list of candidates tried in order, and every entry can be overridden in .env
 * (SEL_BID_INPUT, SEL_BID_BUTTON, ...) when a real session shows something
 * different. Run `npm run inspect` to dump a live room and tune these.
 *
 * Candidate syntax:
 *   "css:..."          -> page.locator  (plain CSS strings are also treated as CSS)
 *   "role:button:Bid"  -> page.getByRole('button', { name: 'Bid' })
 *   "text:Nominate"    -> page.getByText('Nominate')
 */

export type SelectorKey =
  | 'bidInput'
  | 'bidButton'
  | 'passButton'
  | 'nominateButton'
  | 'nominateConfirm'
  | 'searchBox'
  | 'enterDraftButton'
  | 'nominatedPlayer'

export type SelectorConfig = Record<SelectorKey, string[]>

export const DEFAULT_SELECTORS: SelectorConfig = {
  // The bid amount box. Yahoo's auction client uses a numeric input near the Bid button.
  bidInput: ['input[type="number"]', 'css:input[name="bid"]', 'css:input#bid-input', 'css:input[data-testid*="bid" i]'],
  bidButton: ['role:button:Bid', 'text:Bid', 'css:button:has-text("Bid")'],
  passButton: ['role:button:Pass', 'text:Pass', 'css:button:has-text("Pass")'],
  // Tab/button that switches the room into "nominate a player" mode.
  nominateButton: ['role:button:Nominate', 'text:Nominate', 'css:button:has-text("Nominate")'],
  nominateConfirm: ['role:button:Nominate', 'text:Confirm Nomination', 'css:button:has-text("Confirm")'],
  searchBox: ['css:input[type="search"]', 'css:input[placeholder*="search" i]', 'css:input[placeholder*="player" i]'],
  enterDraftButton: ['role:button:Enter Draft', 'text:Enter draft', 'text:Enter Draft', 'css:button:has-text("Enter")'],
  nominatedPlayer: ['css:[class*="player-name" i]', 'css:[class*="nominat" i]', 'css:[data-player]'],
}

/** Env override support: SEL_<KEY_UPPER> = comma-separated candidate list. */
export function selectorsFromEnv(): SelectorConfig {
  const out: SelectorConfig = { ...DEFAULT_SELECTORS }
  for (const key of Object.keys(out) as SelectorKey[]) {
    const raw = process.env[`SEL_${key.toUpperCase()}`]
    if (raw && raw.trim() !== '') {
      out[key] = raw.split(',').map((s) => s.trim()).filter(Boolean)
    }
  }
  return out
}

export async function locatorFor(page: Page, candidates: string[]): Promise<Locator | null> {
  for (const c of candidates) {
    let loc: Locator
    if (c.startsWith('role:')) {
      const [, role, name] = c.split(':')
      if (!role || !name) continue
      loc = page.getByRole(role as never, { name, exact: false })
    } else if (c.startsWith('text:')) {
      loc = page.getByText(c.slice(5), { exact: false })
    } else {
      loc = page.locator(c.startsWith('css:') ? c.slice(4) : c)
    }
    try {
      if ((await loc.count()) > 0) return loc.first()
    } catch {
      // A bad selector (or a detached element) should not kill the loop.
    }
  }
  return null
}

export async function bodyText(page: Page): Promise<string> {
  return page.evaluate(() => document.body?.innerText ?? '')
}
