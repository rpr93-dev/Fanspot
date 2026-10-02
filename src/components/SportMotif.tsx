import type { SportTheme } from '@/lib/sportTheme'

/**
 * Decorative, low-contrast sport motifs (field, court, rink, diamond, circuit)
 * used behind hero banners and home league cards. Purely presentational — the
 * caller controls size and opacity via `className`.
 */
export function SportMotif({
  motif,
  color,
  className,
}: {
  motif: SportTheme['motif']
  color: string
  className?: string
}) {
  const stroke = color
  const common = {
    fill: 'none',
    stroke,
    strokeWidth: 2,
    vectorEffect: 'non-scaling-stroke' as const,
  }
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 400 200"
      preserveAspectRatio="xMidYMid slice"
      className={className}
    >
      {motif === 'gridiron' && (
        <g {...common} opacity={0.5}>
          {Array.from({ length: 9 }, (_, i) => 20 + i * 45).map((x) => (
            <line key={x} x1={x} y1={0} x2={x} y2={200} />
          ))}
          {Array.from({ length: 9 }, (_, i) => 20 + i * 45).map((x) =>
            Array.from({ length: 7 }, (_, j) => (
              <line key={`${x}-${j}`} x1={x - 6} y1={25 + j * 25} x2={x + 6} y2={25 + j * 25} />
            )),
          )}
          <rect x={0} y={70} width={400} height={60} opacity={0.5} />
        </g>
      )}

      {motif === 'hardwood' && (
        <g {...common} opacity={0.45}>
          <rect x={14} y={14} width={372} height={172} rx={4} />
          <line x1={200} y1={14} x2={200} y2={186} />
          <circle cx={200} cy={100} r={34} />
          <path d="M14 40 A 78 78 0 0 1 14 160" />
          <path d="M386 40 A 78 78 0 0 0 386 160" />
          <rect x={14} y={62} width={92} height={76} />
          <rect x={294} y={62} width={92} height={76} />
          <circle cx={106} cy={100} r={20} />
          <circle cx={294} cy={100} r={20} />
        </g>
      )}

      {motif === 'ice' && (
        <g {...common} opacity={0.45}>
          <rect x={14} y={26} width={372} height={148} rx={56} />
          <line x1={200} y1={26} x2={200} y2={174} strokeDasharray="6 5" />
          <line x1={96} y1={26} x2={96} y2={174} stroke="#e11d48" opacity={0.7} />
          <line x1={304} y1={26} x2={304} y2={174} stroke="#e11d48" opacity={0.7} />
          <circle cx={150} cy={68} r={22} />
          <circle cx={150} cy={132} r={22} />
          <circle cx={250} cy={68} r={22} />
          <circle cx={250} cy={132} r={22} />
        </g>
      )}

      {motif === 'diamond' && (
        <g {...common} opacity={0.45}>
          <path d="M200 18 L382 100 L200 182 L18 100 Z" />
          <rect x={186} y={86} width={28} height={28} transform="rotate(45 200 100)" />
          <circle cx={200} cy={100} r={6} />
          <path d="M18 100 Q 200 0 382 100" opacity={0.6} />
          <rect x={44} y={84} width={24} height={24} transform="rotate(45 56 96)" />
          <rect x={332} y={84} width={24} height={24} transform="rotate(45 344 96)" />
          <rect x={188} y={8} width={24} height={24} transform="rotate(45 200 20)" />
          <rect x={188} y={168} width={24} height={24} transform="rotate(45 200 180)" />
        </g>
      )}

      {motif === 'circuit' && (
        <g {...common} opacity={0.5}>
          <path
            d="M60 150 C 20 130 24 70 70 58 C 104 50 120 78 150 84 C 186 92 200 60 236 54 C 286 44 320 66 330 104 C 340 142 300 168 262 158 C 226 148 216 118 184 116 C 150 114 140 152 100 158 C 84 160 70 158 60 150 Z"
            strokeLinejoin="round"
          />
          <line x1={60} y1={150} x2={72} y2={142} strokeWidth={4} strokeDasharray="5 3" />
          <circle cx={60} cy={150} r={4} fill={stroke} stroke="none" />
        </g>
      )}
    </svg>
  )
}
