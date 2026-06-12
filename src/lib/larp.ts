// Layer 1: deterministic, instant LARP scoring. Runs in the browser on a rolling
// window of recent speech. No network, no model — lexicon + heuristics tuned
// for USA tech / internship / YC / startup conversation.
// Layer 2 (Cursor SDK judge) blends in async for nuance.

import {
  STARTUP_AUTHORITY,
  STARTUP_BUZZWORDS,
  STARTUP_VAGUE,
} from "./larpLexicon";

const CONCRETE_RE =
  /\b(\d+(\.\d+)?%?|\$\d|\d{4}|q[1-4]|monday|tuesday|wednesday|thursday|friday|january|february|march|april|may|june|july|august|september|october|november|december)\b/i;

export type LarpL1 = {
  score: number; // 0-100
  tags: string[]; // top buzzwords/phrases seen
  words: number; // word count in window
};

function countPhrase(text: string, phrase: string): number {
  if (!phrase) return 0;
  let n = 0;
  let i = text.indexOf(phrase);
  while (i !== -1) {
    n++;
    i = text.indexOf(phrase, i + phrase.length);
  }
  return n;
}

/**
 * Score a window of transcript text. Designed for ~last 30s of one speaker.
 */
export function scoreL1(text: string): LarpL1 {
  const lower = ` ${text.toLowerCase().replace(/[^a-z0-9%$.\s-]/g, " ").replace(/\s+/g, " ")} `;
  const words = lower.trim() ? lower.trim().split(" ").length : 0;
  if (words < 3) return { score: 0, tags: [], words };

  const hits: Array<{ term: string; weight: number }> = [];
  let buzzWeight = 0;
  for (const [term, weight] of Object.entries(STARTUP_BUZZWORDS)) {
    const c =
      countPhrase(lower, ` ${term} `) +
      countPhrase(lower, `-${term} `) +
      countPhrase(lower, ` ${term}-`);
    if (c > 0) {
      buzzWeight += weight * c;
      hits.push({ term, weight: weight * c });
    }
  }

  let vagueHits = 0;
  for (const v of STARTUP_VAGUE) vagueHits += countPhrase(lower, ` ${v} `);

  let authHits = 0;
  for (const a of STARTUP_AUTHORITY) authHits += countPhrase(lower, ` ${a} `);

  const concreteMatches = (text.match(new RegExp(CONCRETE_RE, "gi")) || []).length;

  const per100 = 100 / Math.max(words, 8);
  const buzzDensity = buzzWeight * per100;
  const vagueDensity = vagueHits * per100;
  const authDensity = authHits * per100;
  const concreteDensity = concreteMatches * per100;

  let raw =
    buzzDensity * 7 +
    vagueDensity * 5 +
    authDensity * 6 -
    concreteDensity * 9;

  const score = Math.max(0, Math.min(100, Math.round(raw)));

  const tags = hits
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 4)
    .map((h) => h.term);

  return { score, tags, words };
}
