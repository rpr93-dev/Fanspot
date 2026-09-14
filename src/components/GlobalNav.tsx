'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSearch } from '@/hooks/useSearch'
import { SearchResults } from './SearchResults'

const LEAGUE_LINKS = [
  { href: '/nfl', label: 'NFL' },
  { href: '/nba', label: 'NBA' },
  { href: '/nhl', label: 'NHL' },
  { href: '/mlb', label: 'MLB' },
]

function DesktopSearch() {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const { teams, players, loading } = useSearch(query)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
      if (e.key === '/' && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault()
        boxRef.current?.querySelector('input')?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  const showResults = open && query.trim().length >= 2

  return (
    <div ref={boxRef} className="relative w-56 lg:w-72">
      <input
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search teams, players…  ( / )"
        aria-label="Search teams and players"
        className="fs-input !py-1.5 text-xs"
      />
      {showResults && (
        <div className="absolute right-0 top-full mt-2 w-80 fs-panel-2 !bg-[#10160f] shadow-2xl z-50 overflow-hidden">
          <SearchResults
            teams={teams}
            players={players}
            loading={loading}
            onNavigate={() => {
              setOpen(false)
              setQuery('')
            }}
          />
        </div>
      )}
    </div>
  )
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function GlobalNav() {
  const pathname = usePathname()
  const [moreOpen, setMoreOpen] = useState(false)

  const desktopLink = (href: string, label: string) => (
    <Link
      key={href}
      href={href}
      aria-current={isActive(pathname, href) ? 'page' : undefined}
      className={`fs-meta !text-[13px] px-3 py-2 rounded-lg transition-colors hover:text-fs-text hover:bg-white/5 ${
        isActive(pathname, href) ? '!text-fs-text bg-white/5' : ''
      }`}
    >
      {label}
    </Link>
  )

  const tab = (href: string, label: string, icon: string) => {
    const active = isActive(pathname, href)
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? 'page' : undefined}
        className={`flex flex-col items-center gap-0.5 px-2 py-1.5 min-w-0 flex-1 rounded-lg transition-colors ${
          active ? 'text-fs-text' : 'text-fs-muted-2 hover:text-fs-muted'
        }`}
      >
        <span className="text-lg leading-none" aria-hidden="true">
          {icon}
        </span>
        <span className="fs-meta !text-[10px] !tracking-[0.08em]">{label}</span>
      </Link>
    )
  }

  return (
    <>
      {/* Desktop / mobile top bar */}
      <header className="sticky top-0 z-40 border-b border-fs-line bg-[#0b0f0d]/90 backdrop-blur-md">
        <div className="fs-shell px-4 sm:px-6">
          <div className="flex items-center gap-2 sm:gap-3 h-14">
            <Link href="/" className="fs-title text-xl tracking-wide shrink-0 mr-1" aria-label="Fanspot home">
              FANSPOT
            </Link>
            <nav className="hidden md:flex items-center gap-0.5" aria-label="Primary">
              {desktopLink('/scores', 'Scores')}
              {LEAGUE_LINKS.map((l) => desktopLink(l.href, l.label))}
              {desktopLink('/fantasy/nfl', 'Fantasy')}
              {desktopLink('/news', 'News')}
            </nav>
            <div className="flex-1" />
            <div className="hidden md:block">
              <DesktopSearch />
            </div>
            <Link
              href="/search"
              className="md:hidden fs-btn !px-3 shrink-0"
              aria-label="Search teams and players"
            >
              ⌕
            </Link>
            <Link
              href="/favorites"
              className="hidden sm:inline-flex md:hidden fs-btn !px-3 shrink-0"
              aria-label="Favorites"
            >
              ★
            </Link>
          </div>
        </div>
      </header>

      {/* Mobile bottom tab bar */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-fs-line bg-[#0b0f0d]/95 backdrop-blur-md"
        aria-label="Mobile"
      >
        <div className="flex items-stretch px-1 pb-[env(safe-area-inset-bottom)]">
          {tab('/', 'Home', '⌂')}
          {tab('/scores', 'Scores', '▦')}
          {tab('/news', 'News', '✎')}
          {tab('/favorites', 'Saved', '★')}
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
            className={`flex flex-col items-center gap-0.5 px-2 py-1.5 min-w-0 flex-1 rounded-lg transition-colors ${
              moreOpen ? 'text-fs-text' : 'text-fs-muted-2'
            }`}
          >
            <span className="text-lg leading-none" aria-hidden="true">
              ⋯
            </span>
            <span className="fs-meta !text-[10px] !tracking-[0.08em]">More</span>
          </button>
        </div>
        {moreOpen && (
          <div className="border-t border-fs-line px-4 py-3 grid grid-cols-2 gap-1">
            {[...LEAGUE_LINKS, { href: '/fantasy/nfl', label: 'Fantasy' }, { href: '/search', label: 'Search' }].map(
              (l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setMoreOpen(false)}
                  className="fs-meta !text-[13px] px-3 py-2.5 rounded-lg hover:bg-white/5 hover:text-fs-text"
                >
                  {l.label}
                </Link>
              ),
            )}
          </div>
        )}
      </nav>
    </>
  )
}
