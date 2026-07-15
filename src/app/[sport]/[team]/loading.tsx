export default function TeamLoading() {
  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #0a0a0f, #1a1a2e)' }}>
      <div className="px-6 py-10">
        <div className="h-4 w-24 rounded mb-8" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }} />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
            <div className="rounded-xl p-6" style={{ backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="h-3 w-20 rounded mb-4" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }} />
              <div className="h-7 w-3/4 rounded" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }} />
              <div className="h-4 w-1/2 rounded mt-3" style={{ backgroundColor: 'rgba(255,255,255,0.04)' }} />
            </div>
            <div className="rounded-xl p-6 flex flex-col items-center justify-center" style={{ backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="w-28 h-28 rounded-full mb-4" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }} />
              <div className="h-6 w-40 rounded" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }} />
            </div>
          </div>

        <div className="mb-5">
          <div className="rounded-xl p-5" style={{ backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="h-3 w-24 rounded mb-3" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }} />
            <div className="grid grid-cols-5 gap-3">
              {[...Array(5)].map((_, j) => (
                <div key={j} className="h-24 rounded-lg animate-pulse" style={{ backgroundColor: 'rgba(255,255,255,0.04)' }} />
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="rounded-xl p-6" style={{ backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="h-3 w-24 rounded mb-4" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }} />
              {[...Array(5)].map((_, j) => (
                <div key={j} className="h-10 rounded-lg mb-2" style={{ backgroundColor: 'rgba(255,255,255,0.04)' }} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}