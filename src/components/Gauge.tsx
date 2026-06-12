import { bandColor } from "../lib/score";

type Props = { score: number };

/** Big solid-stroke ring with the LARP percentage centered. No gradient. */
export function Gauge({ score }: Props) {
  const size = 188;
  const stroke = 16;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score));
  const dash = (pct / 100) * c;
  const color = bandColor(pct);

  return (
    <div className="gauge">
      <svg viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--surface-2)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
          style={{
            transition:
              "stroke-dasharray 240ms linear, stroke 240ms, opacity 240ms",
            opacity: pct < 0.5 ? 0 : 1,
          }}
        />
      </svg>
      <div className="gauge-num">
        <span className="num" style={{ color }}>
          {Math.round(pct)}
        </span>
        <span className="gauge-pct" style={{ color }}>
          %
        </span>
      </div>
    </div>
  );
}
