import type { SportKey } from '@/lib/models'
import { sportTheme } from '@/lib/sportTheme'
import { SportMotif } from './SportMotif'

export interface HeroJump {
  id: string
  label: string
}

/**
 * League hub hero: big display title in the sport's own accent, a faded
 * signature motif (field/court/rink/diamond/circuit), and an in-page jump
 * nav so a reader can move straight to a section.
 */
export function SportHero({ sport, jumps }: { sport: SportKey; jumps?: HeroJump[] }) {
  const t = sportTheme(sport)
  return (
    <header
      className="relative overflow-hidden rounded-2xl border mb-9 animate-fade-in"
      style={{
        borderColor: `${t.accent}45`,
        background: `linear-gradient(118deg, ${t.accent}30 0%, #121813 52%, #10150f 100%)`,
      }}
    >
      <SportMotif
        motif={t.motif}
        color={t.accent}
        className="pointer-events-none absolute right-0 top-0 h-full w-3/5 opacity-[0.16]"
      />
      <span
        aria-hidden="true"
        className="absolute left-0 top-0 h-full w-1"
        style={{ background: `linear-gradient(180deg, ${t.accent}, ${t.accent2})` }}
      />
      <div className="relative px-5 sm:px-8 py-6 sm:py-9">
        <p className="fs-eyebrow mb-2.5" style={{ '--tint': t.accent } as React.CSSProperties}>
          {t.label} · League Hub
        </p>
        <h1 className="fs-title text-4xl sm:text-6xl leading-[0.95]">{t.fullName}</h1>
        <p className="fs-meta mt-3 !tracking-[0.14em]">{t.tagline}</p>

        {jumps && jumps.length > 0 && (
          <nav aria-label="Jump to section" className="flex flex-wrap gap-2 mt-6">
            {jumps.map((j) => (
              <a
                key={j.id}
                href={`#${j.id}`}
                className="fs-mono text-[11px] uppercase tracking-[0.12em] px-3 py-1.5 rounded-full border transition-colors"
                style={{ borderColor: `${t.accent}3d`, color: 'var(--color-fs-muted)' }}
              >
                {j.label}
              </a>
            ))}
          </nav>
        )}
      </div>
    </header>
  )
}
