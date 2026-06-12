export function bandColor(score: number): string {
  if (score < 33) return "var(--low)";
  if (score < 66) return "var(--mid)";
  return "var(--high)";
}

export function verdict(score: number): string {
  if (score < 20) return "Legit";
  if (score < 40) return "Mostly Real";
  if (score < 60) return "Sus";
  if (score < 80) return "Heavy LARP";
  return "Full LARP";
}

export function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}
