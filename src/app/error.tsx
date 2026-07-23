'use client'

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0a0a0f, #1a1a2e)' }}>
      <div className="text-center max-w-md px-6">
        <h1 className="text-2xl font-light text-white/90 mb-2">Something went wrong</h1>
        <p className="text-sm text-gray-500 mb-6">{error.message}</p>
        <button onClick={reset} className="hover-bright px-6 py-2 text-sm text-white/80 rounded-lg" style={{ backgroundColor: 'rgba(255,255,255,0.08)', '--card-color': 'rgba(255,255,255,0.6)' } as React.CSSProperties}>
          Try again
        </button>
      </div>
    </div>
  )
}