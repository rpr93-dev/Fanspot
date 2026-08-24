import type { Page } from 'playwright'
import { locatorFor, type SelectorConfig } from './selectors'

/**
 * The bot's hands. Every action is idempotent-ish and returns a boolean so the
 * controller can fall back to asking the human when a selector fails mid-draft.
 */

export async function enterDraft(page: Page, selectors: SelectorConfig): Promise<boolean> {
  const btn = await locatorFor(page, selectors.enterDraftButton)
  if (!btn) return false
  try {
    await btn.click({ timeout: 3000 })
    return true
  } catch {
    return false
  }
}

/** It's my turn to act when the Bid button is enabled (Yahoo greys it out otherwise). */
export async function isMyTurnToBid(page: Page, selectors: SelectorConfig): Promise<boolean> {
  const bidBtn = await locatorFor(page, selectors.bidButton)
  if (bidBtn) {
    try {
      if (await bidBtn.isEnabled()) return true
    } catch {
      // Element detached mid-check; fall through to text heuristics.
    }
  }
  return false
}

export async function isMyTurnToNominate(page: Page, selectors: SelectorConfig): Promise<boolean> {
  const nomBtn = await locatorFor(page, selectors.nominateButton)
  if (nomBtn) {
    try {
      if (await nomBtn.isEnabled()) return true
    } catch {
      // fall through
    }
  }
  return false
}

/**
 * Set the bid input to `amount` and click Bid. Falls back from fill() to keyboard
 * entry if the input is picky, then verifies the box actually shows the amount.
 */
export async function placeBid(page: Page, selectors: SelectorConfig, amount: number): Promise<boolean> {
  const input = await locatorFor(page, selectors.bidInput)
  if (input) {
    let typed = false
    try {
      await input.click({ timeout: 3000 })
      await input.fill(String(amount))
      typed = true
    } catch {
      try {
        await page.keyboard.press('Control+A')
        await page.keyboard.type(String(amount))
        typed = true
      } catch {
        typed = false
      }
    }
    if (typed) {
      const shown = await input.inputValue().catch(() => '')
      if (shown !== String(amount)) return false
    }
  }

  const bidBtn = await locatorFor(page, selectors.bidButton)
  if (!bidBtn) return false
  try {
    await bidBtn.click({ timeout: 3000 })
    return true
  } catch {
    return false
  }
}

export async function passBid(page: Page, selectors: SelectorConfig): Promise<boolean> {
  const btn = await locatorFor(page, selectors.passButton)
  if (!btn) return false
  try {
    await btn.click({ timeout: 3000 })
    return true
  } catch {
    return false
  }
}

/**
 * Nominate a player: switch to nominate mode, type the name into the search box,
 * pick the first matching result, confirm. Any step failing returns false so the
 * controller can tell the human to do it by hand.
 */
export async function nominatePlayer(page: Page, selectors: SelectorConfig, name: string): Promise<boolean> {
  const tab = await locatorFor(page, selectors.nominateButton)
  if (!tab) return false
  try {
    await tab.click({ timeout: 3000 })
  } catch {
    return false
  }

  const search = await locatorFor(page, selectors.searchBox)
  if (!search) return false
  try {
    await search.click({ timeout: 3000 })
    await search.fill(name)
    await page.waitForTimeout(800)
  } catch {
    return false
  }

  // First result row that mentions the name.
  const result = page
    .locator('[class*="result" i], [class*="player" i], li, tr')
    .filter({ hasText: name })
    .first()
  try {
    await result.click({ timeout: 4000 })
  } catch {
    return false
  }

  const confirm = await locatorFor(page, selectors.nominateConfirm)
  if (!confirm) return false
  try {
    await confirm.click({ timeout: 3000 })
    return true
  } catch {
    return false
  }
}
