/**
 * Loads draft-bot/.env into process.env. Uses Node's native loader (>= 20.12); a
 * missing file is fine — defaults in config.ts take over.
 */
export function loadEnv(): void {
  try {
    const load = (process as unknown as { loadEnvFile?: (path?: string) => void }).loadEnvFile
    if (typeof load === 'function') load('.env')
  } catch {
    // No .env present; rely on config defaults.
  }
}
