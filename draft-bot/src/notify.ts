/**
 * Alerting: a loud terminal banner, a beep, and an optional webhook POST for when
 * the user is not staring at the terminal. Any JSON-capable webhook works (ntfy.sh,
 * Slack incoming webhook, ...) — it receives { text }.
 */

export function banner(msg: string): void {
  const line = '='.repeat(72)
  console.log('\n' + line)
  console.log('  ' + msg)
  console.log(line + '\n')
}

export function beep(): void {
  try {
    process.stdout.write('\x07')
  } catch {
    // No TTY; ignore.
  }
}

export async function alertUser(msg: string, pingUrl: string | null): Promise<void> {
  banner(msg)
  beep()
  if (pingUrl) {
    try {
      await fetch(pingUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: msg }),
        signal: AbortSignal.timeout(5000),
      })
    } catch (err) {
      console.warn(`[notify] webhook failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
